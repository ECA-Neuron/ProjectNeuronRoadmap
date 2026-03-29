"use server";

import { discoverDatabase } from "@/lib/notion/discover";
import { prisma } from "@/lib/prisma";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

const PROGRESS_LOG_DB_TITLE = "Roadmap Progress Log";
const NOTION_V = "2022-06-28";

type NotionApiFn = (path: string, options?: { method?: string; body?: any }) => Promise<any>;

function makeNotionApi(token: string): NotionApiFn {
  return async (path, options) => {
    const res = await fetch(`https://api.notion.com/v1/${path}`, {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_V,
        "Content-Type": "application/json",
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message ?? `Notion API error ${res.status}`);
    }
    return data;
  };
}

let _notionApi: NotionApiFn | null = null;

async function getAllPages(databaseId: string): Promise<PageObjectResponse[]> {
  if (!_notionApi) throw new Error("Notion API not initialized");
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;

  do {
    const res = await _notionApi(`databases/${databaseId}/query`, {
      method: "POST",
      body: { start_cursor: cursor, page_size: 100 },
    });

    for (const r of res.results) {
      if (r.object === "page" && "properties" in r) {
        pages.push(r as unknown as PageObjectResponse);
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

// ─── Property extraction (all fields in this DB are rich_text) ──

function findProp(props: Record<string, any>, namePattern: string) {
  const key = Object.keys(props).find(
    (k) => k.toLowerCase().trim() === namePattern.toLowerCase().trim()
  );
  return key ? props[key] : undefined;
}

function getRichText(prop: any): string {
  if (!prop) return "";
  if (prop.type === "title") return prop.title?.map((t: any) => t.plain_text).join("") ?? "";
  if (prop.type === "rich_text") return prop.rich_text?.map((t: any) => t.plain_text).join("") ?? "";
  return "";
}

function getRichTextNumber(prop: any): number {
  const text = getRichText(prop).trim();
  if (!text) return 0;
  const n = parseFloat(text);
  return isNaN(n) ? 0 : n;
}

function getRelationIds(prop: any): string[] {
  if (!prop) return [];
  if (prop.type === "relation") return prop.relation?.map((r: any) => r.id) ?? [];
  return [];
}

// ─── Hierarchy resolution from Workstreams Roadmap ───

async function resolveHierarchy(roadmapNotionId: string): Promise<{
  subTaskId: string | null;
  initiativeId: string | null;
  deliverableId: string | null;
  workstreamId: string | null;
}> {
  const empty = { subTaskId: null, initiativeId: null, deliverableId: null, workstreamId: null };

  const subTask = await prisma.subTask.findUnique({
    where: { notionPageId: roadmapNotionId },
    include: { initiative: { include: { deliverable: true } } },
  });
  if (subTask) {
    return {
      subTaskId: subTask.id,
      initiativeId: subTask.initiativeId,
      deliverableId: subTask.initiative?.deliverableId ?? null,
      workstreamId: subTask.initiative?.workstreamId ?? null,
    };
  }

  const initiative = await prisma.initiative.findUnique({
    where: { notionPageId: roadmapNotionId },
    include: { deliverable: true },
  });
  if (initiative) {
    return {
      subTaskId: null,
      initiativeId: initiative.id,
      deliverableId: initiative.deliverableId,
      workstreamId: initiative.workstreamId,
    };
  }

  const deliverable = await prisma.deliverable.findUnique({
    where: { notionPageId: roadmapNotionId },
  });
  if (deliverable) {
    return {
      subTaskId: null,
      initiativeId: null,
      deliverableId: deliverable.id,
      workstreamId: deliverable.workstreamId,
    };
  }

  const workstream = await prisma.workstream.findUnique({
    where: { notionPageId: roadmapNotionId },
  });
  if (workstream) {
    return {
      subTaskId: null,
      initiativeId: null,
      deliverableId: null,
      workstreamId: workstream.id,
    };
  }

  return empty;
}

// ─── Fall-back hierarchy resolution by name matching ─

async function resolveByNames(wsName: string, delName: string, epicName: string): Promise<{
  subTaskId: string | null;
  initiativeId: string | null;
  deliverableId: string | null;
  workstreamId: string | null;
}> {
  const empty = { subTaskId: null, initiativeId: null, deliverableId: null, workstreamId: null };

  if (!wsName && !delName && !epicName) return empty;

  let workstreamId: string | null = null;
  let deliverableId: string | null = null;
  let initiativeId: string | null = null;

  if (wsName) {
    const ws = await prisma.workstream.findFirst({
      where: { name: { contains: wsName, mode: "insensitive" } },
    });
    if (ws) workstreamId = ws.id;
  }

  if (delName && workstreamId) {
    const del = await prisma.deliverable.findFirst({
      where: {
        workstreamId,
        name: { contains: delName, mode: "insensitive" },
      },
    });
    if (del) deliverableId = del.id;
  }

  if (epicName && workstreamId) {
    const feat = await prisma.initiative.findFirst({
      where: {
        workstreamId,
        name: { contains: epicName, mode: "insensitive" },
      },
    });
    if (feat) {
      initiativeId = feat.id;
      if (!deliverableId && feat.deliverableId) deliverableId = feat.deliverableId;
    }
  }

  return { subTaskId: null, initiativeId, deliverableId, workstreamId };
}

// ─── Main pull function ──────────────────────────────

export async function pullProgressLog(): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  const dbInfo = await discoverDatabase(PROGRESS_LOG_DB_TITLE);
  if (!dbInfo) {
    errors.push(`Could not find Notion database "${PROGRESS_LOG_DB_TITLE}". Make sure the database is shared with your Notion integration.`);
    return { synced: 0, errors };
  }

  _notionApi = makeNotionApi(dbInfo.token);

  const pages = await getAllPages(dbInfo.id);

  for (const page of pages) {
    try {
      const props = page.properties as Record<string, any>;

      const idNum = getRichText(findProp(props, "id num")).trim();
      const wsName = getRichText(findProp(props, "workstream")).trim();
      const delName = getRichText(findProp(props, "deliverable")).trim();
      const epicName = getRichText(findProp(props, "epic")).trim();

      const taskName = idNum || `${wsName} / ${delName}` || "(untitled)";

      const percentComplete = getRichTextNumber(findProp(props, "percent complete"));
      const totalPoints = getRichTextNumber(findProp(props, "total points"));
      const currentPoints = getRichTextNumber(findProp(props, "current points"));
      const addedPoints = getRichTextNumber(findProp(props, "points added"));

      const updateComment = getRichText(findProp(props, "reason for update")).trim() || null;

      const scopeStatus = getRichText(findProp(props, "original or added scope")).trim() || null;

      const completedBy = getRichText(findProp(props, "update name")).trim().replace(/^@/, "") || null;

      // Parse date from "Scheduled Dates" rich_text (format: "2026-03-09 → 2026-03-12")
      const scheduledDatesText = getRichText(findProp(props, "scheduled dates")).trim();
      let logDate: Date | null = null;
      if (scheduledDatesText) {
        const dateMatch = scheduledDatesText.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) logDate = new Date(dateMatch[1]);
      }
      if (!logDate) {
        logDate = new Date(page.created_time);
      }

      // Resolve hierarchy: first try relation FK, then fall back to name matching
      const taskRelationIds = getRelationIds(findProp(props, "task"));
      let hierarchy = { subTaskId: null as string | null, initiativeId: null as string | null, deliverableId: null as string | null, workstreamId: null as string | null };

      if (taskRelationIds.length > 0) {
        hierarchy = await resolveHierarchy(taskRelationIds[0]);
      }

      // Fall back to name-based resolution if relation didn't resolve
      if (!hierarchy.workstreamId && (wsName || delName || epicName)) {
        hierarchy = await resolveByNames(wsName, delName, epicName);
      }

      await prisma.progressLog.upsert({
        where: { notionPageId: page.id },
        create: {
          notionPageId: page.id,
          taskName,
          percentComplete,
          totalPoints,
          currentPoints,
          addedPoints,
          updateComment,
          scopeStatus,
          logDate,
          completedBy,
          ...hierarchy,
        },
        update: {
          taskName,
          percentComplete,
          totalPoints,
          currentPoints,
          addedPoints,
          updateComment,
          scopeStatus,
          logDate,
          completedBy,
          ...hierarchy,
        },
      });

      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`ProgressLog "${page.id}": ${msg}`);
    }
  }

  return { synced, errors };
}

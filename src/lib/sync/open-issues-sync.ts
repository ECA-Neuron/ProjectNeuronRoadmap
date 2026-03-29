"use server";

import { discoverDatabase, type NotionDbInfo } from "@/lib/notion/discover";
import { prisma } from "@/lib/prisma";

const OPEN_ISSUES_DB_TITLE = "Open Issues";
const NOTION_V = "2022-06-28";

function notionApiWithToken(token: string) {
  return async function notionApi(path: string, options?: { method?: string; body?: any }) {
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
    if (!res.ok) throw new Error(data.message ?? `Notion API error ${res.status}`);
    return data;
  };
}

async function getAllPages(notionApi: ReturnType<typeof notionApiWithToken>, databaseId: string) {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionApi(`databases/${databaseId}/query`, {
      method: "POST",
      body: { start_cursor: cursor, page_size: 100 },
    });
    for (const r of res.results) {
      if (r.object === "page" && "properties" in r) pages.push(r);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function findOpenIssuesDb(): Promise<NotionDbInfo | null> {
  return discoverDatabase(OPEN_ISSUES_DB_TITLE);
}

// ─── Notion page parsing ────────────────────────────

function getText(prop: any): string {
  if (!prop) return "";
  if (prop.type === "title") return (prop.title ?? []).map((t: any) => t.plain_text).join("").trim();
  if (prop.type === "rich_text") return (prop.rich_text ?? []).map((t: any) => t.plain_text).join("").trim();
  return "";
}

function getSelect(prop: any): string | null {
  if (!prop || prop.type !== "select" || !prop.select) return null;
  return prop.select.name ?? null;
}

function getCheckbox(prop: any): boolean {
  if (!prop || prop.type !== "checkbox") return false;
  return !!prop.checkbox;
}

function getRelationIds(prop: any): string[] {
  if (!prop || prop.type !== "relation") return [];
  return (prop.relation ?? []).map((r: any) => r.id?.replace(/-/g, "") || r.id).filter(Boolean);
}

function getDate(prop: any): Date | null {
  if (!prop || prop.type !== "date" || !prop.date) return null;
  const s = prop.date.start;
  return s ? new Date(s) : null;
}

function getPeople(prop: any): string[] {
  if (!prop || prop.type !== "people") return [];
  return (prop.people ?? []).map((p: any) => p.name || p.id).filter(Boolean);
}

interface ParsedIssue {
  notionPageId: string;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  category: string | null;
  assignedTo: string[];
  dateCreated: Date | null;
  resolved: boolean;
  deliverableRelation: string[];
  workstreamRelation: string[];
  taskRelation: string[];
}

function normSeverity(s: string | null): string {
  if (!s) return "NOT_A_CONCERN";
  const u = s.toUpperCase().replace(/[\s_-]+/g, "_");
  if (u.includes("HIGH")) return "STOPPING";
  if (u.includes("MEDIUM") || u.includes("MED")) return "SLOWING";
  if (u.includes("STOP") || u.includes("BLOCK")) return "STOPPING";
  if (u.includes("SLOW")) return "SLOWING";
  return "NOT_A_CONCERN";
}

function normStatus(s: string | null): boolean {
  if (!s) return false;
  const u = s.toUpperCase();
  return u.includes("RESOLVED") || u.includes("CLOSED") || u.includes("DONE");
}

function parsePage(page: any, propSchema: Record<string, { type: string; name: string }>): ParsedIssue {
  const props = page.properties ?? {};

  const findProp = (...names: string[]) => {
    for (const n of names) {
      const key = Object.keys(props).find(k => k.trim().toLowerCase() === n.trim().toLowerCase());
      if (key && props[key]) return props[key];
    }
    return null;
  };

  const title = getText(findProp("issue name", "name", "title", "issue"));
  const description = getText(findProp("issue description", "description", "details", "notes")) || null;
  const severity = normSeverity(getSelect(findProp("severity", "priority", "impact")));
  const status = getSelect(findProp("status")) || "Open";
  const resolved = normStatus(status);
  const category = getSelect(findProp("issue category", "category")) || null;
  const assignedTo = getPeople(findProp("assigned to", "assignee", "assignees"));
  const dateCreated = getDate(findProp("date created", "created", "created at"));
  const deliverableRelation = getRelationIds(findProp("related deliverable", "deliverable", "related deliverables"));
  const workstreamRelation = getRelationIds(findProp("workstream", "workstreams", "parent workstream"));
  const taskRelation = getRelationIds(findProp("related task", "task", "subtask", "sub-task", "blocking task", "related epic"));

  return {
    notionPageId: page.id.replace(/-/g, ""),
    title: title || "(untitled)",
    description,
    severity,
    status,
    category,
    assignedTo,
    dateCreated,
    resolved,
    deliverableRelation,
    workstreamRelation,
    taskRelation,
  };
}

// ─── Pull from Notion ────────────────────────────────

export async function pullOpenIssues(): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];

  const dbInfo = await findOpenIssuesDb();
  if (!dbInfo) {
    errors.push(`Could not find Notion database "${OPEN_ISSUES_DB_TITLE}" or "Open Issues". Make sure the database is shared with the Notion integration. Go to the database in Notion → ··· menu → Add connections → select your integration.`);
    return { synced: 0, errors };
  }

  const notionApi = notionApiWithToken(dbInfo.token);

  console.log(`[open-issues-sync] Found DB "${dbInfo.title}" (${dbInfo.id}). Properties:`,
    Object.entries(dbInfo.properties).map(([k, v]) => `${k} (${v.type})`).join(", ")
  );

  const pages = await getAllPages(notionApi, dbInfo.id);
  console.log(`[open-issues-sync] Fetched ${pages.length} pages from Notion`);
  const wsLookup = new Map<string, string>();
  const taskLookup = new Map<string, string>();
  const deliverableLookup = new Map<string, { id: string; workstreamId: string }>();

  const [allWs, allTasks, allDeliverables] = await Promise.all([
    prisma.workstream.findMany({ select: { id: true, notionPageId: true } }),
    prisma.subTask.findMany({ select: { id: true, notionPageId: true } }),
    prisma.deliverable.findMany({ select: { id: true, notionPageId: true, workstreamId: true } }),
  ]);

  for (const ws of allWs) {
    if (ws.notionPageId) wsLookup.set(ws.notionPageId.replace(/-/g, ""), ws.id);
  }
  for (const t of allTasks) {
    if (t.notionPageId) taskLookup.set(t.notionPageId.replace(/-/g, ""), t.id);
  }
  for (const d of allDeliverables) {
    if (d.notionPageId) deliverableLookup.set(d.notionPageId.replace(/-/g, ""), { id: d.id, workstreamId: d.workstreamId });
  }

  const defaultWs = allWs[0];

  let synced = 0;
  for (const page of pages) {
    try {
      const parsed = parsePage(page, dbInfo.properties);

      let workstreamId: string | null = null;
      for (const relId of parsed.workstreamRelation) {
        const id = wsLookup.get(relId.replace(/-/g, ""));
        if (id) { workstreamId = id; break; }
      }
      if (!workstreamId) {
        for (const relId of parsed.deliverableRelation) {
          const d = deliverableLookup.get(relId.replace(/-/g, ""));
          if (d) { workstreamId = d.workstreamId; break; }
        }
      }
      if (!workstreamId && defaultWs) workstreamId = defaultWs.id;

      let subTaskId: string | null = null;
      for (const relId of parsed.taskRelation) {
        const id = taskLookup.get(relId.replace(/-/g, ""));
        if (id) { subTaskId = id; break; }
      }

      const existing = await prisma.openIssue.findUnique({
        where: { notionPageId: parsed.notionPageId },
      });

      if (existing) {
        await prisma.openIssue.update({
          where: { id: existing.id },
          data: {
            title: parsed.title,
            description: parsed.description,
            severity: parsed.severity,
            workstreamId: workstreamId ?? undefined,
            subTaskId,
            resolvedAt: parsed.resolved ? (existing.resolvedAt ?? new Date()) : null,
          },
        });
      } else {
        await prisma.openIssue.create({
          data: {
            notionPageId: parsed.notionPageId,
            title: parsed.title,
            description: parsed.description,
            severity: parsed.severity,
            ...(workstreamId ? { workstreamId } : {}),
            subTaskId,
            resolvedAt: parsed.resolved ? new Date() : null,
          },
        });
      }
      synced++;
    } catch (e) {
      errors.push(`Error processing issue page: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { synced, errors };
}

// ─── Push to Notion ──────────────────────────────────

export async function pushOpenIssues(): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];

  const dbInfo = await findOpenIssuesDb();
  if (!dbInfo) {
    errors.push(`Could not find Notion database "${OPEN_ISSUES_DB_TITLE}" or "Open Issues". Make sure the database is shared with the Notion integration.`);
    return { synced: 0, errors };
  }

  const notionApi = notionApiWithToken(dbInfo.token);

  const issues = await prisma.openIssue.findMany({
    include: { workstream: { select: { notionPageId: true } } },
  });

  let synced = 0;
  for (const issue of issues) {
    try {
      const properties: Record<string, any> = {};

      const titleKey = Object.keys(dbInfo.properties).find(k =>
        dbInfo.properties[k].type === "title"
      );
      if (titleKey) {
        properties[titleKey] = { title: [{ text: { content: issue.title } }] };
      }

      const descKey = Object.keys(dbInfo.properties).find(k =>
        k.toLowerCase().includes("description") || k.toLowerCase().includes("details")
      );
      if (descKey && issue.description) {
        properties[descKey] = { rich_text: [{ text: { content: issue.description } }] };
      }

      const sevKey = Object.keys(dbInfo.properties).find(k =>
        k.toLowerCase().includes("severity") || k.toLowerCase().includes("priority")
      );
      if (sevKey && dbInfo.properties[sevKey].type === "select") {
        const label = issue.severity === "STOPPING" ? "High"
          : issue.severity === "SLOWING" ? "Medium" : "Low";
        properties[sevKey] = { select: { name: label } };
      }

      const statusKey = Object.keys(dbInfo.properties).find(k =>
        k.toLowerCase() === "status"
      );
      if (statusKey && dbInfo.properties[statusKey].type === "select") {
        properties[statusKey] = { select: { name: issue.resolvedAt ? "Resolved" : "Open" } };
      }

      if (issue.notionPageId) {
        await notionApi(`pages/${issue.notionPageId}`, {
          method: "PATCH",
          body: { properties },
        });
      } else {
        const res = await notionApi("pages", {
          method: "POST",
          body: {
            parent: { database_id: dbInfo.id },
            properties,
          },
        });
        const newPageId = (res.id as string).replace(/-/g, "");
        await prisma.openIssue.update({
          where: { id: issue.id },
          data: { notionPageId: newPageId },
        });
      }
      synced++;
    } catch (e) {
      errors.push(`Error pushing issue "${issue.title}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { synced, errors };
}

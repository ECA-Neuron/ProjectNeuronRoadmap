"use server";

import { discoverDatabase } from "@/lib/notion/discover";
import {
  parseNotionPage,
  buildNotionProperties,
  type ParsedNotionPage,
  type NotionLevel,
} from "@/lib/notion/mappers";
import { prisma } from "@/lib/prisma";
import { pullProgressLog } from "@/lib/sync/progress-sync";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

const ROADMAP_DB_TITLE = "Neuron Workstreams Roadmap";
const NOTION_V = "2022-06-28";

// ---------------------------------------------------------------------------
// Raw Notion API helper — uses the token discovered for the target DB
// ---------------------------------------------------------------------------

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

let _activeNotionApi: NotionApiFn | null = null;

function notionApi(path: string, options?: { method?: string; body?: any }) {
  if (!_activeNotionApi) throw new Error("notionApi not initialized — call discoverDatabase first");
  return _activeNotionApi(path, options);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAllPages(databaseId: string): Promise<PageObjectResponse[]> {
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;

  do {
    const res = await notionApi(`databases/${databaseId}/query`, {
      method: "POST",
      body: {
        start_cursor: cursor,
        page_size: 100,
      },
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const personCache = new Map<string, string>();

async function findOrCreatePerson(name: string): Promise<string> {
  const key = name.toLowerCase().trim();
  if (personCache.has(key)) return personCache.get(key)!;

  let person = await prisma.person.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });

  if (!person) {
    const initials = name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 3);
    person = await prisma.person.create({
      data: { name, initials },
    });
  }

  personCache.set(key, person.id);
  return person.id;
}

// ---------------------------------------------------------------------------
// PULL: Notion → Database
// ---------------------------------------------------------------------------

export async function pullFromNotion(
  syncLogId: string,
  syncType: string
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  const dbInfo = await discoverDatabase(ROADMAP_DB_TITLE);
  if (!dbInfo) {
    errors.push(`Could not find Notion database "${ROADMAP_DB_TITLE}". Make sure the database is shared with your Notion integration.`);
    await prisma.syncLog.update({
      where: { id: syncLogId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errors: JSON.stringify(errors),
      },
    });
    return { synced: 0, errors };
  }

  _activeNotionApi = makeNotionApi(dbInfo.token);

  const pages = await getAllPages(dbInfo.id);

  // Log the property names from the first page so we can discover relation properties
  if (pages.length > 0) {
    const propSummary = Object.entries(pages[0].properties).map(([k, v]) => `${k} (${v.type})`).join(", ");
    console.log(`[roadmap-sync] DB properties: ${propSummary}`);
  }

  const parsed = pages.map(parseNotionPage);

  // Log dependency stats
  const depsFound = parsed.reduce((sum, p) => sum + p.dependencyNotionIds.length + p.blockingNotionIds.length, 0);
  console.log(`[roadmap-sync] Parsed ${parsed.length} pages, ${depsFound} dependency links found (blocked-by + blocking)`);

  // We need a default program to attach workstreams to
  let defaultProgram = await prisma.program.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!defaultProgram) {
    defaultProgram = await prisma.program.create({
      data: { name: "Project Neuron" },
    });
  }

  // Build lookup maps: notionPageId → parsed page
  const byId = new Map<string, ParsedNotionPage>();
  const notionIdSet = new Set<string>();
  const notionLevelMap = new Map<string, NotionLevel>();
  for (const p of parsed) {
    byId.set(p.notionPageId, p);
    notionIdSet.add(p.notionPageId);
    if (p.level) notionLevelMap.set(p.notionPageId, p.level);
  }

  // ── Pre-sync: compute which notionPageIds are TRUE Deliverables ──
  // A "Deliverable" in Notion is only a true DB Deliverable if its direct
  // parent is a Workstream. Sub-deliverables (parent is another Deliverable)
  // are stored as Features (Initiatives) instead.
  const trueDeliverableIds = new Set<string>();
  for (const p of parsed) {
    if (p.level !== "Deliverable") continue;
    const parentPage = p.parentNotionId ? byId.get(p.parentNotionId) : null;
    if (!parentPage || parentPage.level === "Workstream") {
      trueDeliverableIds.add(p.notionPageId);
    }
  }

  // ── Pre-sync cleanup: delete stale records ──
  // Remove items no longer in Notion, or stored at the wrong DB level.
  const models = ["subTask", "initiative", "deliverable", "workstream"] as const;
  for (const model of models) {
    const rows: { id: string; notionPageId: string }[] = await (prisma as any)[model].findMany({
      where: { notionPageId: { not: null } },
      select: { id: true, notionPageId: true },
    });

    for (const row of rows) {
      let shouldDelete = false;

      if (!notionIdSet.has(row.notionPageId)) {
        shouldDelete = true; // removed from Notion
      } else if (model === "deliverable" && !trueDeliverableIds.has(row.notionPageId)) {
        shouldDelete = true; // sub-deliverable stored wrongly as Deliverable
      } else if (model === "initiative") {
        const nlvl = notionLevelMap.get(row.notionPageId);
        if (nlvl === "Deliverable" && trueDeliverableIds.has(row.notionPageId)) {
          shouldDelete = true; // true deliverable stored wrongly as Initiative
        }
      } else {
        const nlvl = notionLevelMap.get(row.notionPageId);
        const expected: Record<string, string> = { workstream: "Workstream", deliverable: "Deliverable", initiative: "Feature", subTask: "Task" };
        if (nlvl && nlvl !== expected[model]) {
          shouldDelete = true; // level mismatch
        }
      }

      if (shouldDelete) {
        try {
          await (prisma as any)[model].delete({ where: { id: row.id } });
        } catch { /* cascade may have removed it */ }
      }
    }
  }

  // Clean up auto-created pass-through features (no notionPageId)
  await prisma.initiative.deleteMany({ where: { notionPageId: null } });

  // Level-aware lookup: notionPageId → { level, dbId }
  const notionMeta = new Map<string, { level: NotionLevel; dbId: string }>();

  // Walk the Notion hierarchy chain upward to find an ancestor at a given level
  function findAncestorDbId(startNotionId: string | null, targetLevel: NotionLevel): string | null {
    const visited = new Set<string>();
    let current = startNotionId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const meta = notionMeta.get(current);
      if (meta && meta.level === targetLevel) return meta.dbId;
      const page = byId.get(current);
      current = page?.parentNotionId ?? null;
    }
    return null;
  }

  // Process in hierarchy order: Workstream → Deliverable → Feature → Task
  const levels: NotionLevel[] = ["Workstream", "Deliverable", "Feature", "Task"];

  for (const level of levels) {
    const items = parsed.filter((p) => p.level === level);

    for (const item of items) {
      try {
        if (level === "Workstream") {
          const existing = await prisma.workstream.findUnique({
            where: { notionPageId: item.notionPageId },
          });

          if (existing) {
            await prisma.workstream.update({
              where: { id: existing.id },
              data: {
                name: item.name,
                status: item.status,
                startDate: item.startDate,
                endDate: item.endDate,
              },
            });
            notionMeta.set(item.notionPageId, { level: "Workstream", dbId: existing.id });
          } else {
            const ws = await prisma.workstream.create({
              data: {
                programId: defaultProgram.id,
                name: item.name,
                slug: slugify(item.name),
                status: item.status,
                startDate: item.startDate,
                endDate: item.endDate,
                notionPageId: item.notionPageId,
              },
            });
            notionMeta.set(item.notionPageId, { level: "Workstream", dbId: ws.id });
          }
          synced++;
        }

        if (level === "Deliverable") {
          // Check if the parent is a Workstream (true Deliverable) or another
          // Deliverable (sub-deliverable → store as Feature/Initiative instead).
          const parentPage = item.parentNotionId ? byId.get(item.parentNotionId) : null;
          const parentIsDeliverable = parentPage?.level === "Deliverable";

          if (parentIsDeliverable) {
            // ── Sub-deliverable: store as Feature (Initiative) ──
            const parentDelId = findAncestorDbId(item.parentNotionId, "Deliverable");
            let workstreamId: string | null = null;
            if (parentDelId) {
              const del = await prisma.deliverable.findUnique({ where: { id: parentDelId } });
              workstreamId = del?.workstreamId ?? null;
            }
            if (!workstreamId) {
              workstreamId = findAncestorDbId(item.parentNotionId, "Workstream");
            }
            if (!workstreamId) {
              errors.push(`Sub-deliverable "${item.name}" — no workstream found`);
              continue;
            }

            const existing = await prisma.initiative.findUnique({
              where: { notionPageId: item.notionPageId },
            });

            if (existing) {
              await prisma.initiative.update({
                where: { id: existing.id },
                data: {
                  name: item.name,
                  status: item.status,
                  startDate: item.startDate,
                  endDate: item.endDate,
                  totalPoints: item.points,
                  deliverableId: parentDelId,
                  workstreamId,
                },
              });
              notionMeta.set(item.notionPageId, { level: "Feature", dbId: existing.id });
            } else {
              const init = await prisma.initiative.create({
                data: {
                  workstreamId,
                  deliverableId: parentDelId,
                  name: item.name,
                  status: item.status,
                  startDate: item.startDate,
                  endDate: item.endDate,
                  totalPoints: item.points,
                  notionPageId: item.notionPageId,
                },
              });
              notionMeta.set(item.notionPageId, { level: "Feature", dbId: init.id });
            }
            synced++;
          } else {
            // ── True Deliverable: parent is a Workstream ──
            let workstreamId = findAncestorDbId(item.parentNotionId, "Workstream");

            if (!workstreamId && item.parentNotionId) {
              const parentWs = await prisma.workstream.findUnique({
                where: { notionPageId: item.parentNotionId },
              });
              if (parentWs) workstreamId = parentWs.id;
            }

            if (!workstreamId) {
              errors.push(`Deliverable "${item.name}" — no parent workstream found, skipping`);
              continue;
            }

            const existing = await prisma.deliverable.findUnique({
              where: { notionPageId: item.notionPageId },
            });

            if (existing) {
              await prisma.deliverable.update({
                where: { id: existing.id },
                data: {
                  name: item.name,
                  status: item.status,
                  startDate: item.startDate,
                  endDate: item.endDate,
                  points: item.points,
                  workstreamId,
                },
              });
              notionMeta.set(item.notionPageId, { level: "Deliverable", dbId: existing.id });
            } else {
              const del = await prisma.deliverable.create({
                data: {
                  workstreamId,
                  name: item.name,
                  status: item.status,
                  startDate: item.startDate,
                  endDate: item.endDate,
                  points: item.points,
                  notionPageId: item.notionPageId,
                },
              });
              notionMeta.set(item.notionPageId, { level: "Deliverable", dbId: del.id });
            }
            synced++;
          }
        }

        if (level === "Feature") {
          // Walk up to find parent Deliverable or Feature (for sub-deliverables stored as Features)
          let deliverableId = findAncestorDbId(item.parentNotionId, "Deliverable");

          // Parent might be a sub-deliverable (stored as Feature) — try Feature ancestor too
          let featureParentId: string | null = null;
          if (!deliverableId) {
            featureParentId = findAncestorDbId(item.parentNotionId, "Feature");
          }

          let workstreamId: string | null = null;
          if (deliverableId) {
            const del = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
            workstreamId = del?.workstreamId ?? null;
          }
          if (!workstreamId && featureParentId) {
            const feat = await prisma.initiative.findUnique({ where: { id: featureParentId } });
            workstreamId = feat?.workstreamId ?? null;
            if (!deliverableId && feat?.deliverableId) deliverableId = feat.deliverableId;
          }
          if (!workstreamId) {
            workstreamId = findAncestorDbId(item.parentNotionId, "Workstream");
          }

          if (!workstreamId) {
            errors.push(`Feature "${item.name}" — no parent workstream found, skipping`);
            continue;
          }

          const existing = await prisma.initiative.findUnique({
            where: { notionPageId: item.notionPageId },
          });

          if (existing) {
            await prisma.initiative.update({
              where: { id: existing.id },
              data: {
                name: item.name,
                status: item.status,
                startDate: item.startDate,
                endDate: item.endDate,
                totalPoints: item.points,
                deliverableId,
                workstreamId,
                ownerInitials: item.assignName ?? existing.ownerInitials,
              },
            });
            notionMeta.set(item.notionPageId, { level: "Feature", dbId: existing.id });
          } else {
            const init = await prisma.initiative.create({
              data: {
                workstreamId,
                deliverableId,
                name: item.name,
                status: item.status,
                startDate: item.startDate,
                endDate: item.endDate,
                totalPoints: item.points,
                notionPageId: item.notionPageId,
                ownerInitials: item.assignName,
              },
            });
            notionMeta.set(item.notionPageId, { level: "Feature", dbId: init.id });
          }
          synced++;
        }

        if (level === "Task") {
          // Walk up to find parent Feature (Initiative)
          let initiativeId = findAncestorDbId(item.parentNotionId, "Feature");

          if (!initiativeId && item.parentNotionId) {
            const parentInit = await prisma.initiative.findUnique({
              where: { notionPageId: item.parentNotionId },
            });
            if (parentInit) initiativeId = parentInit.id;
          }

          // If Task is directly under a Deliverable, auto-create an Initiative
          if (!initiativeId && item.parentNotionId) {
            const parentDelId = findAncestorDbId(item.parentNotionId, "Deliverable");
            if (parentDelId) {
              const del = await prisma.deliverable.findUnique({ where: { id: parentDelId } });
              if (del) {
                const autoName = `${del.name} — Tasks`;
                let autoInit = await prisma.initiative.findFirst({
                  where: { deliverableId: del.id, name: autoName },
                });
                if (!autoInit) {
                  autoInit = await prisma.initiative.create({
                    data: {
                      workstreamId: del.workstreamId,
                      deliverableId: del.id,
                      name: autoName,
                      status: del.status,
                    },
                  });
                }
                initiativeId = autoInit.id;
              }
            }
          }

          if (!initiativeId) {
            errors.push(`Task "${item.name}" — no parent feature or deliverable found, skipping`);
            continue;
          }

          const assigneeId = item.assignName
            ? await findOrCreatePerson(item.assignName)
            : null;

          const existing = await prisma.subTask.findUnique({
            where: { notionPageId: item.notionPageId },
          });

          if (existing) {
            await prisma.subTask.update({
              where: { id: existing.id },
              data: {
                name: item.name,
                status: item.status,
                startDate: item.startDate,
                endDate: item.endDate,
                points: item.points,
                completionPercent: item.percentComplete,
                initiativeId,
                ...(assigneeId ? { assigneeId } : {}),
              },
            });
            notionMeta.set(item.notionPageId, { level: "Task", dbId: existing.id });
          } else {
            const sub = await prisma.subTask.create({
              data: {
                initiativeId,
                name: item.name,
                status: item.status,
                startDate: item.startDate,
                endDate: item.endDate,
                points: item.points,
                completionPercent: item.percentComplete,
                notionPageId: item.notionPageId,
                ...(assigneeId ? { assigneeId } : {}),
              },
            });
            notionMeta.set(item.notionPageId, { level: "Task", dbId: sub.id });
          }
          synced++;
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err);
        errors.push(`${level} "${item.name}": ${msg}`);
      }
    }
  }

  // ── Sync dependencies ──
  // Resolve Notion page IDs to Initiative (Feature) DB IDs using notionMeta,
  // then batch-create InitiativeDependency rows.
  try {
    await prisma.initiativeDependency.deleteMany({});

    // Pre-build a map: notionPageId → initiativeId for fast resolution
    const taskDbIds = Array.from(notionMeta.entries())
      .filter(([, m]) => m.level === "Task")
      .map(([, m]) => m.dbId);

    const taskInitMap = new Map<string, string>();
    if (taskDbIds.length > 0) {
      const subs = await prisma.subTask.findMany({
        where: { id: { in: taskDbIds } },
        select: { id: true, initiativeId: true },
      });
      for (const s of subs) taskInitMap.set(s.id, s.initiativeId);
    }

    function resolveToInitiativeId(notionId: string): string | null {
      const meta = notionMeta.get(notionId);
      if (!meta) return null;
      if (meta.level === "Feature") return meta.dbId;
      if (meta.level === "Task") return taskInitMap.get(meta.dbId) ?? null;
      return null;
    }

    const depEdges: { initiativeId: string; dependsOnId: string }[] = [];
    const seen = new Set<string>();

    for (const item of parsed) {
      const thisInitId = resolveToInitiativeId(item.notionPageId);

      // "Blocked by" — this item depends on each listed page
      if (item.dependencyNotionIds.length > 0 && thisInitId) {
        for (const depNotionId of item.dependencyNotionIds) {
          const depInitId = resolveToInitiativeId(depNotionId);
          if (!depInitId || depInitId === thisInitId) continue;
          const key = `${thisInitId}:${depInitId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          depEdges.push({ initiativeId: thisInitId, dependsOnId: depInitId });
        }
      }

      // "Blocking" — each listed page depends on this item
      if (item.blockingNotionIds.length > 0 && thisInitId) {
        for (const blockedNotionId of item.blockingNotionIds) {
          const blockedInitId = resolveToInitiativeId(blockedNotionId);
          if (!blockedInitId || blockedInitId === thisInitId) continue;
          const key = `${blockedInitId}:${thisInitId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          depEdges.push({ initiativeId: blockedInitId, dependsOnId: thisInitId });
        }
      }
    }

    if (depEdges.length > 0) {
      await prisma.initiativeDependency.createMany({ data: depEdges, skipDuplicates: true });
    }
    console.log(`[sync] Synced ${depEdges.length} dependencies`);
  } catch (err) {
    errors.push(`Dependencies sync: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { synced, errors };
}

// ---------------------------------------------------------------------------
// PUSH: Database → Notion
// ---------------------------------------------------------------------------

async function updateNotionPage(pageId: string, properties: Record<string, unknown>) {
  return notionApi(`pages/${pageId}`, {
    method: "PATCH",
    body: { properties },
  });
}

async function createNotionPage(params: Record<string, unknown>) {
  return notionApi("pages", {
    method: "POST",
    body: params,
  }) as Promise<{ id: string }>;
}

export async function pushToNotion(
  syncLogId: string,
  lastSyncedAt: Date | null
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  const dbInfo = await discoverDatabase(ROADMAP_DB_TITLE);
  if (!dbInfo) {
    errors.push(`Could not find Notion database "${ROADMAP_DB_TITLE}". Make sure the database is shared with your Notion integration.`);
    return { synced: 0, errors };
  }

  _activeNotionApi = makeNotionApi(dbInfo.token);

  const since = lastSyncedAt ?? new Date(0);

  // Push updated Workstreams
  const changedWs = await prisma.workstream.findMany({
    where: {
      updatedAt: { gt: since },
      notionPageId: { not: null },
    },
  });

  for (const ws of changedWs) {
    try {
      const props = buildNotionProperties(ws, "Workstream");
      await updateNotionPage(ws.notionPageId!, props);
      synced++;
    } catch (err) {
      errors.push(
        `Push Workstream "${ws.name}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Push updated Deliverables
  const changedDel = await prisma.deliverable.findMany({
    where: {
      updatedAt: { gt: since },
      notionPageId: { not: null },
    },
  });

  for (const del of changedDel) {
    try {
      const props = buildNotionProperties(del, "Deliverable");
      await updateNotionPage(del.notionPageId!, props);
      synced++;
    } catch (err) {
      errors.push(
        `Push Deliverable "${del.name}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Push updated Initiatives (Features)
  const changedInit = await prisma.initiative.findMany({
    where: {
      updatedAt: { gt: since },
      notionPageId: { not: null },
    },
  });

  for (const init of changedInit) {
    try {
      const props = buildNotionProperties(
        {
          name: init.name,
          status: init.status,
          startDate: init.startDate,
          endDate: init.endDate,
          points: init.totalPoints,
        },
        "Feature"
      );
      await updateNotionPage(init.notionPageId!, props);
      synced++;
    } catch (err) {
      errors.push(
        `Push Feature "${init.name}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Push updated SubTasks (Tasks)
  const changedSub = await prisma.subTask.findMany({
    where: {
      updatedAt: { gt: since },
      notionPageId: { not: null },
    },
  });

  for (const sub of changedSub) {
    try {
      const props = buildNotionProperties(sub, "Task");
      await updateNotionPage(sub.notionPageId!, props);
      synced++;
    } catch (err) {
      errors.push(
        `Push Task "${sub.name}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── Create new records in Notion (no notionPageId yet) ──

  // New Workstreams
  const newWs = await prisma.workstream.findMany({
    where: { updatedAt: { gt: since }, notionPageId: null },
  });
  for (const ws of newWs) {
    try {
      const props = buildNotionProperties(ws, "Workstream");
      const created = await createNotionPage({
        parent: { database_id: dbInfo.id },
        properties: props,
      });
      await prisma.workstream.update({ where: { id: ws.id }, data: { notionPageId: created.id } });
      synced++;
    } catch (err) {
      errors.push(`Create Workstream "${ws.name}" in Notion: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // New Deliverables
  const newDel = await prisma.deliverable.findMany({
    where: { updatedAt: { gt: since }, notionPageId: null },
    include: { workstream: true },
  });
  for (const del of newDel) {
    try {
      const parentNotionId = del.workstream?.notionPageId;
      const props = buildNotionProperties(del, "Deliverable");
      const created = await createNotionPage({
        parent: parentNotionId ? { page_id: parentNotionId } : { database_id: dbInfo.id },
        properties: props,
      });
      await prisma.deliverable.update({ where: { id: del.id }, data: { notionPageId: created.id } });
      synced++;
    } catch (err) {
      errors.push(`Create Deliverable "${del.name}" in Notion: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // New Initiatives (Features)
  const newInit = await prisma.initiative.findMany({
    where: { updatedAt: { gt: since }, notionPageId: null },
    include: { deliverable: true, workstream: true },
  });
  for (const init of newInit) {
    try {
      const parentNotionId = init.deliverable?.notionPageId ?? init.workstream?.notionPageId;
      const props = buildNotionProperties(
        { name: init.name, status: init.status, startDate: init.startDate, endDate: init.endDate, points: init.totalPoints },
        "Feature",
      );
      const created = await createNotionPage({
        parent: parentNotionId ? { page_id: parentNotionId } : { database_id: dbInfo.id },
        properties: props,
      });
      await prisma.initiative.update({ where: { id: init.id }, data: { notionPageId: created.id } });
      synced++;
    } catch (err) {
      errors.push(`Create Feature "${init.name}" in Notion: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // New SubTasks (Tasks)
  const newSubs = await prisma.subTask.findMany({
    where: { updatedAt: { gt: since }, notionPageId: null },
    include: { initiative: true },
  });
  for (const sub of newSubs) {
    try {
      const parentNotionId = sub.initiative?.notionPageId;
      const props = buildNotionProperties(sub, "Task");
      const created = await createNotionPage({
        parent: parentNotionId ? { page_id: parentNotionId } : { database_id: dbInfo.id },
        properties: props,
      });
      await prisma.subTask.update({ where: { id: sub.id }, data: { notionPageId: created.id } });
      synced++;
    } catch (err) {
      errors.push(`Create Task "${sub.name}" in Notion: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { synced, errors };
}

// ---------------------------------------------------------------------------
// Full bidirectional sync
// ---------------------------------------------------------------------------

export async function runSync(
  syncType: "MANUAL" | "SCHEDULED"
): Promise<{
  syncLogId: string;
  pullResult: { synced: number; errors: string[] };
  pushResult: { synced: number; errors: string[] };
}> {
  // Find the last successful sync time
  const lastSync = await prisma.syncLog.findFirst({
    where: { status: "SUCCESS" },
    orderBy: { completedAt: "desc" },
  });

  const syncLog = await prisma.syncLog.create({
    data: {
      syncType,
      direction: "BIDIRECTIONAL",
      status: "RUNNING",
    },
  });

  try {
    const pullResult = await pullFromNotion(syncLog.id, syncType);

    // Also pull progress log entries
    const progressResult = await pullProgressLog();
    pullResult.synced += progressResult.synced;
    pullResult.errors.push(...progressResult.errors);

    const pushResult = await pushToNotion(
      syncLog.id,
      lastSync?.completedAt ?? null
    );

    const allErrors = [...pullResult.errors, ...pushResult.errors];

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: allErrors.length > 0 ? "PARTIAL" : "SUCCESS",
        completedAt: new Date(),
        itemsSynced: pullResult.synced + pushResult.synced,
        errors: allErrors.length > 0 ? JSON.stringify(allErrors) : null,
      },
    });

    return { syncLogId: syncLog.id, pullResult, pushResult };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errors: JSON.stringify([msg]),
      },
    });
    return {
      syncLogId: syncLog.id,
      pullResult: { synced: 0, errors: [msg] },
      pushResult: { synced: 0, errors: [] },
    };
  }
}

// ---------------------------------------------------------------------------
// Pull-only sync (Notion → Database)
// ---------------------------------------------------------------------------

export async function runPullOnly(
  syncType: "MANUAL" | "SCHEDULED" | "AUTO"
): Promise<{
  syncLogId: string;
  pullResult: { synced: number; errors: string[] };
}> {
  const syncLog = await prisma.syncLog.create({
    data: {
      syncType,
      direction: "PULL",
      status: "RUNNING",
    },
  });

  try {
    const pullResult = await pullFromNotion(syncLog.id, syncType);

    // Also pull progress log entries (runs after roadmap so hierarchy FKs resolve)
    const progressResult = await pullProgressLog();
    pullResult.synced += progressResult.synced;
    pullResult.errors.push(...progressResult.errors);

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: pullResult.errors.length > 0 ? "PARTIAL" : "SUCCESS",
        completedAt: new Date(),
        itemsSynced: pullResult.synced,
        errors: pullResult.errors.length > 0 ? JSON.stringify(pullResult.errors) : null,
      },
    });

    return { syncLogId: syncLog.id, pullResult };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errors: JSON.stringify([msg]),
      },
    });
    return {
      syncLogId: syncLog.id,
      pullResult: { synced: 0, errors: [msg] },
    };
  }
}

// ---------------------------------------------------------------------------
// Push-only sync (Database → Notion)
// ---------------------------------------------------------------------------

export async function runPushOnly(
  syncType: "MANUAL" | "SCHEDULED" | "AUTO"
): Promise<{
  syncLogId: string;
  pushResult: { synced: number; errors: string[] };
}> {
  const lastSync = await prisma.syncLog.findFirst({
    where: { status: { in: ["SUCCESS", "PARTIAL"] }, direction: { in: ["PUSH", "BIDIRECTIONAL"] } },
    orderBy: { completedAt: "desc" },
  });

  const syncLog = await prisma.syncLog.create({
    data: {
      syncType,
      direction: "PUSH",
      status: "RUNNING",
    },
  });

  try {
    const pushResult = await pushToNotion(
      syncLog.id,
      lastSync?.completedAt ?? null
    );

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: pushResult.errors.length > 0 ? "PARTIAL" : "SUCCESS",
        completedAt: new Date(),
        itemsSynced: pushResult.synced,
        errors: pushResult.errors.length > 0 ? JSON.stringify(pushResult.errors) : null,
      },
    });

    return { syncLogId: syncLog.id, pushResult };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errors: JSON.stringify([msg]),
      },
    });
    return {
      syncLogId: syncLog.id,
      pushResult: { synced: 0, errors: [msg] },
    };
  }
}

"use server";

import { getNotionClientAsync } from "@/lib/notion/client";
import type { Client } from "@notionhq/client";
import { discoverDatabase } from "@/lib/notion/discover";
import {
  parseNotionPage,
  buildNotionProperties,
  type ParsedNotionPage,
  type NotionLevel,
} from "@/lib/notion/mappers";
import { prisma } from "@/lib/prisma";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

const ROADMAP_DB_TITLE = "Neuron Workstreams Roadmap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAllPages(databaseId: string): Promise<PageObjectResponse[]> {
  const notion = await getNotionClientAsync();
  const pages: PageObjectResponse[] = [];
  let cursor: string | undefined;

  // SDK v5 types may not expose databases.query — use untyped call
  const queryDb = (notion.databases as Record<string, Function>).query
    ?? ((params: Record<string, unknown>) =>
      (notion as unknown as { request: Function }).request({
        path: `databases/${databaseId}/query`,
        method: "POST",
        body: params,
      }));

  do {
    const res = await queryDb({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    }) as { results: Record<string, unknown>[]; has_more: boolean; next_cursor: string | null };

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
    errors.push(`Could not find Notion database "${ROADMAP_DB_TITLE}"`);
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

  const pages = await getAllPages(dbInfo.id);
  const parsed = pages.map(parseNotionPage);

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
  for (const p of parsed) {
    byId.set(p.notionPageId, p);
  }

  // Process in hierarchy order: Workstream → Deliverable → Feature → Task
  const levels: NotionLevel[] = ["Workstream", "Deliverable", "Feature", "Task"];

  // Track notionPageId → db record id for parent linking
  const notionToDbId = new Map<string, string>();

  for (const level of levels) {
    const items = parsed.filter((p) => p.level === level);

    for (const item of items) {
      try {
        if (level === "Workstream") {
          const existing = await prisma.workstream.findUnique({
            where: { notionPageId: item.notionPageId },
          });

          if (existing) {
            // Last-write-wins: only update if Notion is newer
            if (item.lastEditedTime > existing.updatedAt) {
              await prisma.workstream.update({
                where: { id: existing.id },
                data: {
                  name: item.name,
                  status: item.status,
                  startDate: item.startDate,
                  endDate: item.endDate,
                },
              });
            }
            notionToDbId.set(item.notionPageId, existing.id);
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
            notionToDbId.set(item.notionPageId, ws.id);
          }
          synced++;
        }

        if (level === "Deliverable") {
          // Find parent workstream
          const parentDbId = item.parentNotionId
            ? notionToDbId.get(item.parentNotionId)
            : null;

          // Fall back: look up by notionPageId in the DB
          let workstreamId = parentDbId;
          if (!workstreamId && item.parentNotionId) {
            const parentWs = await prisma.workstream.findUnique({
              where: { notionPageId: item.parentNotionId },
            });
            if (parentWs) workstreamId = parentWs.id;
          }

          if (!workstreamId) {
            // Attach to first workstream as fallback
            const first = await prisma.workstream.findFirst({
              orderBy: { sortOrder: "asc" },
            });
            workstreamId = first?.id;
          }

          if (!workstreamId) {
            errors.push(
              `Deliverable "${item.name}" — no parent workstream found`
            );
            continue;
          }

          const existing = await prisma.deliverable.findUnique({
            where: { notionPageId: item.notionPageId },
          });

          if (existing) {
            if (item.lastEditedTime > existing.updatedAt) {
              await prisma.deliverable.update({
                where: { id: existing.id },
                data: {
                  name: item.name,
                  status: item.status,
                  startDate: item.startDate,
                  endDate: item.endDate,
                  points: item.points,
                },
              });
            }
            notionToDbId.set(item.notionPageId, existing.id);
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
            notionToDbId.set(item.notionPageId, del.id);
          }
          synced++;
        }

        if (level === "Feature") {
          // Find parent deliverable
          const parentDbId = item.parentNotionId
            ? notionToDbId.get(item.parentNotionId)
            : null;

          let deliverableId = parentDbId;
          if (!deliverableId && item.parentNotionId) {
            const parentDel = await prisma.deliverable.findUnique({
              where: { notionPageId: item.parentNotionId },
            });
            if (parentDel) deliverableId = parentDel.id;
          }

          // We need workstreamId for Initiative — get it through the deliverable
          let workstreamId: string | null = null;
          if (deliverableId) {
            const del = await prisma.deliverable.findUnique({
              where: { id: deliverableId },
            });
            workstreamId = del?.workstreamId ?? null;
          }

          if (!workstreamId) {
            // Fall back to first workstream
            const first = await prisma.workstream.findFirst({
              orderBy: { sortOrder: "asc" },
            });
            workstreamId = first?.id ?? null;
          }

          if (!workstreamId) {
            errors.push(
              `Feature "${item.name}" — no parent workstream found`
            );
            continue;
          }

          const existing = await prisma.initiative.findUnique({
            where: { notionPageId: item.notionPageId },
          });

          if (existing) {
            if (item.lastEditedTime > existing.updatedAt) {
              await prisma.initiative.update({
                where: { id: existing.id },
                data: {
                  name: item.name,
                  status: item.status,
                  startDate: item.startDate,
                  endDate: item.endDate,
                  totalPoints: item.points,
                  deliverableId,
                },
              });
            }
            notionToDbId.set(item.notionPageId, existing.id);
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
              },
            });
            notionToDbId.set(item.notionPageId, init.id);
          }
          synced++;
        }

        if (level === "Task") {
          // Find parent initiative (Feature)
          const parentDbId = item.parentNotionId
            ? notionToDbId.get(item.parentNotionId)
            : null;

          let initiativeId = parentDbId;
          if (!initiativeId && item.parentNotionId) {
            const parentInit = await prisma.initiative.findUnique({
              where: { notionPageId: item.parentNotionId },
            });
            if (parentInit) initiativeId = parentInit.id;
          }

          if (!initiativeId) {
            const first = await prisma.initiative.findFirst({
              orderBy: { sortOrder: "asc" },
            });
            initiativeId = first?.id ?? null;
          }

          if (!initiativeId) {
            errors.push(`Task "${item.name}" — no parent initiative found`);
            continue;
          }

          const existing = await prisma.subTask.findUnique({
            where: { notionPageId: item.notionPageId },
          });

          if (existing) {
            if (item.lastEditedTime > existing.updatedAt) {
              await prisma.subTask.update({
                where: { id: existing.id },
                data: {
                  name: item.name,
                  status: item.status,
                  startDate: item.startDate,
                  endDate: item.endDate,
                  points: item.points,
                },
              });
            }
            notionToDbId.set(item.notionPageId, existing.id);
          } else {
            const sub = await prisma.subTask.create({
              data: {
                initiativeId,
                name: item.name,
                status: item.status,
                startDate: item.startDate,
                endDate: item.endDate,
                points: item.points,
                notionPageId: item.notionPageId,
              },
            });
            notionToDbId.set(item.notionPageId, sub.id);
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

  return { synced, errors };
}

// ---------------------------------------------------------------------------
// PUSH: Database → Notion
// ---------------------------------------------------------------------------

// Wrappers to bypass SDK v5 strict property types
function updatePage(notion: Client, params: Record<string, unknown>) {
  return (notion.pages.update as Function)(params);
}
function createPage(notion: Client, params: Record<string, unknown>) {
  return (notion.pages.create as Function)(params) as Promise<{ id: string }>;
}

export async function pushToNotion(
  syncLogId: string,
  lastSyncedAt: Date | null
): Promise<{ synced: number; errors: string[] }> {
  const notion = await getNotionClientAsync();
  const errors: string[] = [];
  let synced = 0;

  const dbInfo = await discoverDatabase(ROADMAP_DB_TITLE);
  if (!dbInfo) {
    errors.push(`Could not find Notion database "${ROADMAP_DB_TITLE}"`);
    return { synced: 0, errors };
  }

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
      await updatePage(notion, { page_id: ws.notionPageId!, properties: props });
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
      await updatePage(notion, { page_id: del.notionPageId!, properties: props });
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
      await updatePage(notion, { page_id: init.notionPageId!, properties: props });
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
      await updatePage(notion, { page_id: sub.notionPageId!, properties: props });
      synced++;
    } catch (err) {
      errors.push(
        `Push Task "${sub.name}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Create new records in Notion (no notionPageId yet)
  const newSubs = await prisma.subTask.findMany({
    where: {
      updatedAt: { gt: since },
      notionPageId: null,
    },
    include: { initiative: true },
  });

  for (const sub of newSubs) {
    try {
      const parentNotionId = sub.initiative?.notionPageId;
      const props = buildNotionProperties(sub, "Task");
      const created = await createPage(notion, {
        parent: parentNotionId
          ? { page_id: parentNotionId }
          : { database_id: dbInfo.id },
        properties: props,
      });

      await prisma.subTask.update({
        where: { id: sub.id },
        data: { notionPageId: created.id },
      });
      synced++;
    } catch (err) {
      errors.push(
        `Create Task "${sub.name}" in Notion: ${err instanceof Error ? err.message : String(err)}`
      );
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

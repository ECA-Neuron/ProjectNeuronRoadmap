"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

import { discoverDatabase } from "@/lib/notion/discover";
import { getNotionToken } from "@/lib/notion/client";

const PROGRESS_LOG_DB_TITLE = "Roadmap Progress Log";
const NOTION_V = "2022-06-28";

interface LogInput {
  subTaskId: string;
  currentPoints: number;
  totalPoints: number;
  percentComplete: number;
  comment: string;
}

function richText(content: string) {
  return { rich_text: [{ text: { content } }] };
}

export async function logProgressUpdate(input: LogInput) {
  const session = await requireRole(["ADMIN", "MEMBER"]);
  const userName = session.user?.name ?? "Unknown";

  const subTask = await prisma.subTask.findUnique({
    where: { id: input.subTaskId },
    include: {
      initiative: {
        include: {
          deliverable: { include: { workstream: true } },
          workstream: true,
        },
      },
    },
  });
  if (!subTask) throw new Error("SubTask not found");

  const initiative = subTask.initiative;
  const deliverable = initiative?.deliverable;
  const workstream = initiative?.workstream ?? deliverable?.workstream;

  const logDate = new Date();
  const todayStr = logDate.toISOString().slice(0, 10);

  const progressLog = await prisma.progressLog.create({
    data: {
      taskName: subTask.name,
      percentComplete: input.percentComplete,
      totalPoints: input.totalPoints,
      currentPoints: input.currentPoints,
      addedPoints: 0,
      updateComment: input.comment || null,
      scopeStatus: "Original",
      logDate,
      completedBy: userName,
      subTaskId: subTask.id,
      initiativeId: initiative?.id ?? null,
      deliverableId: deliverable?.id ?? null,
      workstreamId: workstream?.id ?? null,
    },
  });

  await prisma.subTask.update({
    where: { id: subTask.id },
    data: {
      completionPercent: Math.round(input.percentComplete),
      points: input.totalPoints,
    },
  });

  // Fire-and-forget: push to Notion in background so we return fast
  // and don't timeout on Render waiting for Notion API calls.
  notionPushBackground(
    progressLog.id, subTask.name, subTask.notionPageId,
    input, userName, todayStr,
    workstream ? { name: workstream.name } : null,
    deliverable ? { name: deliverable.name } : null,
    initiative ? { name: initiative.name } : null,
  );

  return { id: progressLog.id, taskName: subTask.name };
}

function notionPushBackground(
  logId: string, taskName: string, taskNotionId: string | null,
  input: LogInput, userName: string, todayStr: string,
  ws: { name: string } | null,
  del: { name: string } | null,
  init: { name: string } | null,
) {
  (async () => {
    try {
      const dbInfo = await discoverDatabase(PROGRESS_LOG_DB_TITLE);
      if (!dbInfo) return;
      const token = await getNotionToken();
      const properties: Record<string, unknown> = {
        "Percent Complete": richText(String(input.percentComplete / 100)),
        "Current Points ": richText(String(input.currentPoints)),
        "Reason for Update": richText(input.comment || ""),
        "Update Name": richText(userName),
        "Date Added": { date: { start: todayStr } },
      };
      if (ws) properties["Workstream"] = richText(ws.name);
      if (del) properties["Deliverable"] = richText(del.name);
      if (init) properties["Epic"] = richText(init.name);
      if (taskNotionId) properties["Task"] = { relation: [{ id: taskNotionId }] };

      const res = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_V,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ parent: { database_id: dbInfo.id }, properties }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        await prisma.progressLog.update({ where: { id: logId }, data: { notionPageId: data.id } });
      } else {
        console.error("Notion push failed:", data.message ?? data);
      }
    } catch (err) {
      console.error("Background Notion push failed:", err);
    }
  })();
}

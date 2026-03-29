"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
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

  // Push to Notion Progress Log database
  try {
    const dbInfo = await discoverDatabase(PROGRESS_LOG_DB_TITLE);
    if (dbInfo) {
      const token = await getNotionToken();

      const properties: Record<string, unknown> = {
        "ID Num": richText(subTask.name),
        "Percent Complete": richText(String(input.percentComplete)),
        "Total Points": richText(String(input.totalPoints)),
        "Current Points": richText(String(input.currentPoints)),
        "Reason for update": richText(input.comment || ""),
        "Update Name": richText(`@${userName}`),
        "Scheduled Dates": richText(todayStr),
        "Original or Added Scope": richText("Original"),
      };

      if (workstream) {
        properties["Workstream"] = richText(workstream.name);
      }
      if (deliverable) {
        properties["Deliverable"] = richText(deliverable.name);
      }
      if (initiative) {
        properties["Epic"] = richText(initiative.name);
      }

      // Link to the SubTask page in the Workstreams Roadmap via relation
      if (subTask.notionPageId) {
        properties["Task"] = { relation: [{ id: subTask.notionPageId }] };
      }

      const res = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_V,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { database_id: dbInfo.id },
          properties,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        await prisma.progressLog.update({
          where: { id: progressLog.id },
          data: { notionPageId: data.id },
        });
      } else {
        console.error("Notion progress log push failed:", data.message ?? data);
      }
    }
  } catch (err) {
    console.error("Failed to push progress update to Notion:", err);
  }

  revalidatePath("/burndown");
  revalidatePath("/roadmap");
  return { id: progressLog.id, taskName: subTask.name };
}

"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth-helpers";
import { getNotionToken } from "@/lib/notion/client";
import { buildNotionProperties, type NotionLevel } from "@/lib/notion/mappers";

type Level = "Workstream" | "Deliverable" | "Feature" | "Task";

const NOTION_V = "2022-06-28";

async function patchNotionPage(pageId: string, properties: Record<string, unknown>) {
  const token = await getNotionToken();
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_V,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const data = await res.json();
    console.error("Notion patch error:", data.message ?? res.status);
  }
}

interface UpdateDatesInput {
  id: string;
  level: Level;
  startDate?: string | null;
  endDate?: string | null;
}

interface UpdateItemInput {
  id: string;
  level: Level;
  name?: string;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export async function updateRoadmapDates(input: UpdateDatesInput) {
  await requireRole(["ADMIN", "MEMBER"]);

  const { id, level, startDate, endDate } = input;
  const data: Record<string, Date | null> = {};

  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;

  let record: any;
  switch (level) {
    case "Workstream":
      record = await prisma.workstream.update({ where: { id }, data });
      break;
    case "Deliverable":
      record = await prisma.deliverable.update({ where: { id }, data });
      break;
    case "Feature":
      record = await prisma.initiative.update({ where: { id }, data });
      break;
    case "Task":
      record = await prisma.subTask.update({ where: { id }, data });
      break;
  }

  if (record?.notionPageId) {
    const notionLevel: NotionLevel = level === "Feature" ? "Feature" : level;
    const full = level === "Feature"
      ? { name: record.name, status: record.status, startDate: record.startDate, endDate: record.endDate, points: record.totalPoints }
      : record;
    try {
      const props = buildNotionProperties(full, notionLevel);
      await patchNotionPage(record.notionPageId, props);
    } catch { /* sync will catch it later */ }
  }

  revalidatePath("/roadmap");
  revalidatePath("/burndown");
  return { ok: true };
}

export async function updateRoadmapItem(input: UpdateItemInput) {
  await requireRole(["ADMIN", "MEMBER"]);

  const { id, level } = input;
  const data: Record<string, string | Date | null | undefined> = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.status !== undefined) data.status = input.status;
  if (input.startDate !== undefined) data.startDate = input.startDate ? new Date(input.startDate) : null;
  if (input.endDate !== undefined) data.endDate = input.endDate ? new Date(input.endDate) : null;

  let record: any;
  switch (level) {
    case "Workstream":
      record = await prisma.workstream.update({ where: { id }, data });
      break;
    case "Deliverable":
      record = await prisma.deliverable.update({ where: { id }, data });
      break;
    case "Feature":
      record = await prisma.initiative.update({ where: { id }, data });
      break;
    case "Task":
      record = await prisma.subTask.update({ where: { id }, data });
      break;
  }

  if (record?.notionPageId) {
    const notionLevel: NotionLevel = level === "Feature" ? "Feature" : level;
    const full = level === "Feature"
      ? { name: record.name, status: record.status, startDate: record.startDate, endDate: record.endDate, points: record.totalPoints }
      : record;
    try {
      const props = buildNotionProperties(full, notionLevel);
      await patchNotionPage(record.notionPageId, props);
    } catch { /* sync will catch it later */ }
  }

  revalidatePath("/roadmap");
  revalidatePath("/burndown");
  return { ok: true };
}

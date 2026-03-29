"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { buildNotionProperties } from "@/lib/notion/mappers";
import { discoverDatabase } from "@/lib/notion/discover";
import { getNotionToken } from "@/lib/notion/client";

type Level = "Workstream" | "Deliverable" | "Feature" | "Task";

interface AddItemInput {
  level: Level;
  name: string;
  parentId: string | null;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  points?: number;
  assigneeId?: string | null;
  estimatedDays?: number | null;
  riskLevel?: string | null;
}

function calcPoints(estimatedDays: number | null | undefined, riskLevel: string | null | undefined): number {
  if (!estimatedDays || estimatedDays <= 0) return 0;
  switch (riskLevel) {
    case "Very High": return Math.ceil(estimatedDays + 4);
    case "High":      return Math.ceil(estimatedDays + 3);
    case "Medium":    return Math.ceil(estimatedDays + 2);
    case "Low":       return Math.ceil(estimatedDays < 1 ? estimatedDays * 2 : estimatedDays + 1);
    default:          return Math.ceil(estimatedDays);
  }
}

const ROADMAP_DB_TITLE = "Neuron Workstreams Roadmap";
const NOTION_V = "2022-06-28";

async function createNotionPage(params: Record<string, unknown>): Promise<{ id: string }> {
  const token = await getNotionToken();
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_V,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `Notion API error ${res.status}`);
  return data;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function addRoadmapItem(input: AddItemInput) {
  await requireRole(["ADMIN", "MEMBER"]);

  const { level, name, parentId, status = "NOT_STARTED" } = input;
  const startDate = input.startDate ? new Date(input.startDate) : null;
  const endDate = input.endDate ? new Date(input.endDate) : null;
  const points = input.estimatedDays != null
    ? calcPoints(input.estimatedDays, input.riskLevel)
    : (input.points ?? 0);

  let record: { id: string; notionPageId: string | null; name: string };
  let parentNotionId: string | null = null;

  if (level === "Workstream") {
    let defaultProgram = await prisma.program.findFirst({ orderBy: { createdAt: "asc" } });
    if (!defaultProgram) {
      defaultProgram = await prisma.program.create({ data: { name: "Project Neuron" } });
    }
    const count = await prisma.workstream.count();
    const ws = await prisma.workstream.create({
      data: {
        programId: defaultProgram.id,
        name,
        slug: slugify(name),
        status,
        startDate,
        endDate,
        sortOrder: count,
      },
    });
    record = { id: ws.id, notionPageId: null, name };
  } else if (level === "Deliverable") {
    if (!parentId) throw new Error("Deliverable requires a parent Workstream");
    const parent = await prisma.workstream.findUnique({ where: { id: parentId } });
    if (!parent) throw new Error("Parent workstream not found");
    parentNotionId = parent.notionPageId;

    const count = await prisma.deliverable.count({ where: { workstreamId: parentId } });
    const del = await prisma.deliverable.create({
      data: {
        workstreamId: parentId,
        name,
        status,
        startDate,
        endDate,
        points,
        sortOrder: count,
      },
    });
    record = { id: del.id, notionPageId: null, name };
  } else if (level === "Feature") {
    if (!parentId) throw new Error("Feature requires a parent Deliverable");
    const parentDel = await prisma.deliverable.findUnique({
      where: { id: parentId },
      include: { workstream: true },
    });
    if (!parentDel) throw new Error("Parent deliverable not found");
    parentNotionId = parentDel.notionPageId;

    const init = await prisma.initiative.create({
      data: {
        workstreamId: parentDel.workstreamId,
        deliverableId: parentId,
        name,
        status,
        startDate,
        endDate,
        totalPoints: points,
      },
    });
    record = { id: init.id, notionPageId: null, name };
  } else {
    if (!parentId) throw new Error("Task requires a parent Feature");
    const parentInit = await prisma.initiative.findUnique({ where: { id: parentId } });
    if (!parentInit) throw new Error("Parent feature not found");
    parentNotionId = parentInit.notionPageId;

    const count = await prisma.subTask.count({ where: { initiativeId: parentId } });
    const sub = await prisma.subTask.create({
      data: {
        initiativeId: parentId,
        name,
        status,
        startDate,
        endDate,
        points,
        sortOrder: count,
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        ...(input.estimatedDays != null ? { estimatedDays: input.estimatedDays } : {}),
        ...(input.riskLevel ? { unknowns: input.riskLevel } : {}),
      },
    });
    record = { id: sub.id, notionPageId: null, name };
  }

  // Push to Notion immediately
  try {
    const notionLevel = level === "Feature" ? "Feature" : level;
    const dbRecord = { name, status, startDate, endDate, points };
    const props = buildNotionProperties(dbRecord, notionLevel);

    const dbInfo = await discoverDatabase(ROADMAP_DB_TITLE);
    if (dbInfo) {
      const created = await createNotionPage({
        parent: parentNotionId
          ? { page_id: parentNotionId }
          : { database_id: dbInfo.id },
        properties: props,
      });

      const model = { Workstream: "workstream", Deliverable: "deliverable", Feature: "initiative", Task: "subTask" }[level] as string;
      await (prisma as any)[model].update({
        where: { id: record.id },
        data: { notionPageId: created.id },
      });
      record.notionPageId = created.id;
    }
  } catch (err) {
    console.error(`Failed to push new ${level} "${name}" to Notion:`, err);
  }

  revalidatePath("/roadmap");
  revalidatePath("/burndown");
  return record;
}

"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getNotionToken } from "@/lib/notion/client";

type Level = "Workstream" | "Deliverable" | "Feature" | "Task";

interface DeleteItemInput {
  id: string;
  level: Level;
}

export async function deleteRoadmapItem(input: DeleteItemInput) {
  await requireRole(["ADMIN", "MEMBER"]);

  const { id, level } = input;
  const model = { Workstream: "workstream", Deliverable: "deliverable", Feature: "initiative", Task: "subTask" }[level] as string;

  const existing = await (prisma as any)[model].findUnique({
    where: { id },
    select: { notionPageId: true },
  });

  if (!existing) throw new Error(`${level} not found`);

  if (existing.notionPageId) {
    try {
      const token = await getNotionToken();
      await fetch(`https://api.notion.com/v1/pages/${existing.notionPageId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ archived: true }),
      });
    } catch (err) {
      console.error(`Failed to archive Notion page for ${level} "${id}":`, err);
    }
  }

  await (prisma as any)[model].delete({ where: { id } });

  revalidatePath("/roadmap");
  revalidatePath("/my-dashboard");

  return { success: true };
}

"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getNotionToken } from "@/lib/notion/client";

export async function addDependency(input: {
  initiativeId: string;
  dependsOnId: string;
}) {
  await requireRole(["ADMIN", "MEMBER"]);

  if (input.initiativeId === input.dependsOnId) {
    throw new Error("An item cannot depend on itself");
  }

  const existing = await prisma.initiativeDependency.findFirst({
    where: {
      initiativeId: input.initiativeId,
      dependsOnId: input.dependsOnId,
    },
  });

  if (existing) return { success: true, id: existing.id };

  const dep = await prisma.initiativeDependency.create({
    data: {
      initiativeId: input.initiativeId,
      dependsOnId: input.dependsOnId,
    },
  });

  // Push to Notion: update "Blocked by" relation on the initiative page
  try {
    const initiative = await prisma.initiative.findUnique({
      where: { id: input.initiativeId },
      select: { notionPageId: true },
    });
    const dependsOn = await prisma.initiative.findUnique({
      where: { id: input.dependsOnId },
      select: { notionPageId: true },
    });

    if (initiative?.notionPageId && dependsOn?.notionPageId) {
      const allDeps = await prisma.initiativeDependency.findMany({
        where: { initiativeId: input.initiativeId },
        include: { dependsOn: { select: { notionPageId: true } } },
      });
      const relationIds = allDeps
        .map((d) => d.dependsOn.notionPageId)
        .filter(Boolean)
        .map((nid) => ({ id: nid! }));

      const token = await getNotionToken();
      await fetch(`https://api.notion.com/v1/pages/${initiative.notionPageId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: { "Blocked by": { relation: relationIds } },
        }),
      });
    }
  } catch (err) {
    console.error("Failed to push dependency to Notion:", err);
  }

  revalidatePath("/roadmap");
  return { success: true, id: dep.id };
}

export async function removeDependency(input: {
  initiativeId: string;
  dependsOnId: string;
}) {
  await requireRole(["ADMIN", "MEMBER"]);

  await prisma.initiativeDependency.deleteMany({
    where: {
      initiativeId: input.initiativeId,
      dependsOnId: input.dependsOnId,
    },
  });

  // Push updated relation list to Notion
  try {
    const initiative = await prisma.initiative.findUnique({
      where: { id: input.initiativeId },
      select: { notionPageId: true },
    });

    if (initiative?.notionPageId) {
      const remainingDeps = await prisma.initiativeDependency.findMany({
        where: { initiativeId: input.initiativeId },
        include: { dependsOn: { select: { notionPageId: true } } },
      });
      const relationIds = remainingDeps
        .map((d) => d.dependsOn.notionPageId)
        .filter(Boolean)
        .map((nid) => ({ id: nid! }));

      const token = await getNotionToken();
      await fetch(`https://api.notion.com/v1/pages/${initiative.notionPageId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: { "Blocked by": { relation: relationIds } },
        }),
      });
    }
  } catch (err) {
    console.error("Failed to update Notion dependency:", err);
  }

  revalidatePath("/roadmap");
  return { success: true };
}

export async function getFeatureList() {
  const features = await prisma.initiative.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return features;
}

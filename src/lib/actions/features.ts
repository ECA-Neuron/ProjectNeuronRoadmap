// @ts-nocheck
"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { featureSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getFeatures(includeArchived = false) {
  return prisma.feature.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    include: {
      theme: true,
      featureGroup: true,
      owner: true,
      parentFeature: true,
      childFeatures: true,
      checklistItems: true,
      milestones: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getFeature(id: string) {
  return prisma.feature.findUnique({
    where: { id },
    include: {
      theme: true,
      featureGroup: true,
      owner: true,
      parentFeature: true,
      childFeatures: true,
      checklistItems: { orderBy: { sortOrder: "asc" } },
      milestones: { orderBy: { sortOrder: "asc" } },
      burndownSnapshots: { orderBy: { date: "asc" } },
      issues: true,
      assignments: { include: { resource: true } },
      costEntries: true,
      decisionLogs: true,
      goals: { include: { goal: true } },
    },
  });
}

export async function createFeature(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = featureSchema.parse(data);
  const feature = await prisma.feature.create({
    data: {
      ...parsed,
      plannedStart: parsed.plannedStart ? new Date(parsed.plannedStart) : null,
      plannedEnd: parsed.plannedEnd ? new Date(parsed.plannedEnd) : null,
    },
  });
  revalidatePath("/features");
  revalidatePath("/roadmap");
  revalidatePath("/dashboard");
  return feature;
}

export async function updateFeature(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = featureSchema.parse(data);
  const feature = await prisma.feature.update({
    where: { id },
    data: {
      ...parsed,
      plannedStart: parsed.plannedStart ? new Date(parsed.plannedStart) : null,
      plannedEnd: parsed.plannedEnd ? new Date(parsed.plannedEnd) : null,
    },
  });
  revalidatePath("/features");
  revalidatePath("/roadmap");
  revalidatePath("/dashboard");
  return feature;
}

export async function archiveFeature(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.feature.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  revalidatePath("/features");
  revalidatePath("/roadmap");
}

export async function unarchiveFeature(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.feature.update({
    where: { id },
    data: { archivedAt: null },
  });
  revalidatePath("/features");
}



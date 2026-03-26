// @ts-nocheck
"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { goalSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getGoals(includeArchived = false) {
  return prisma.goal.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    include: {
      owner: true,
      features: { include: { feature: true } },
      checklistItems: true,
      milestones: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getGoal(id: string) {
  return prisma.goal.findUnique({
    where: { id },
    include: {
      owner: true,
      features: { include: { feature: true } },
      checklistItems: { orderBy: { sortOrder: "asc" } },
      milestones: { orderBy: { sortOrder: "asc" } },
      burndownSnapshots: { orderBy: { date: "asc" } },
      issues: true,
      assignments: { include: { resource: true } },
      costEntries: true,
      decisionLogs: true,
    },
  });
}

export async function createGoal(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = goalSchema.parse(data);
  const goal = await prisma.goal.create({
    data: {
      ...parsed,
      startDate: parsed.startDate ? new Date(parsed.startDate) : null,
      endDate: parsed.endDate ? new Date(parsed.endDate) : null,
    },
  });
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  return goal;
}

export async function updateGoal(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = goalSchema.parse(data);
  const goal = await prisma.goal.update({
    where: { id },
    data: {
      ...parsed,
      startDate: parsed.startDate ? new Date(parsed.startDate) : null,
      endDate: parsed.endDate ? new Date(parsed.endDate) : null,
    },
  });
  revalidatePath("/goals");
  revalidatePath("/dashboard");
  return goal;
}

export async function archiveGoal(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.goal.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  revalidatePath("/goals");
}

export async function linkFeatureToGoal(goalId: string, featureId: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.goalFeature.create({
    data: { goalId, featureId },
  });
  revalidatePath("/goals");
}

export async function unlinkFeatureFromGoal(goalId: string, featureId: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.goalFeature.deleteMany({
    where: { goalId, featureId },
  });
  revalidatePath("/goals");
}



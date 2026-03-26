// @ts-nocheck
"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { burndownSnapshotSchema, checklistItemSchema, milestoneSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getBurndownSnapshots(featureId?: string, goalId?: string) {
  return prisma.burndownSnapshot.findMany({
    where: {
      ...(featureId ? { featureId } : {}),
      ...(goalId ? { goalId } : {}),
    },
    orderBy: { date: "asc" },
  });
}

export async function createBurndownSnapshot(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = burndownSnapshotSchema.parse(data);
  const snapshot = await prisma.burndownSnapshot.create({
    data: {
      ...parsed,
      date: new Date(parsed.date),
      totalWork: parsed.totalWork ?? null,
    },
  });
  revalidatePath("/burndown");
  return snapshot;
}

// ─── Checklist Items ────────────────────────────
export async function getChecklistItems(featureId?: string, goalId?: string) {
  return prisma.checklistItem.findMany({
    where: {
      ...(featureId ? { featureId } : {}),
      ...(goalId ? { goalId } : {}),
    },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createChecklistItem(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = checklistItemSchema.parse(data);
  const item = await prisma.checklistItem.create({ data: parsed });
  revalidatePath("/burndown");
  revalidatePath("/features");
  revalidatePath("/goals");
  return item;
}

export async function toggleChecklistItem(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  const item = await prisma.checklistItem.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.checklistItem.update({
    where: { id },
    data: { completed: !item.completed },
  });
  revalidatePath("/burndown");
  revalidatePath("/features");
  revalidatePath("/goals");
  return updated;
}

export async function deleteChecklistItem(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.checklistItem.delete({ where: { id } });
  revalidatePath("/burndown");
}

// ─── Milestones ─────────────────────────────────
export async function getMilestones(featureId?: string, goalId?: string) {
  return prisma.milestone.findMany({
    where: {
      ...(featureId ? { featureId } : {}),
      ...(goalId ? { goalId } : {}),
    },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createMilestone(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = milestoneSchema.parse(data);
  const ms = await prisma.milestone.create({
    data: {
      ...parsed,
      targetDate: parsed.targetDate ? new Date(parsed.targetDate) : null,
    },
  });
  revalidatePath("/burndown");
  return ms;
}

export async function completeMilestone(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  const ms = await prisma.milestone.findUniqueOrThrow({ where: { id } });
  await prisma.milestone.update({
    where: { id },
    data: { completedAt: ms.completedAt ? null : new Date() },
  });
  revalidatePath("/burndown");
}

export async function deleteMilestone(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.milestone.delete({ where: { id } });
  revalidatePath("/burndown");
}



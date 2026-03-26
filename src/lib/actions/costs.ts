// @ts-nocheck
"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { costEntrySchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getCostEntries() {
  return prisma.costEntry.findMany({
    include: { feature: true, goal: true, issue: true },
    orderBy: { date: "desc" },
  });
}

export async function createCostEntry(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = costEntrySchema.parse(data);
  const entry = await prisma.costEntry.create({
    data: {
      ...parsed,
      date: new Date(parsed.date),
    },
  });
  revalidatePath("/cost");
  return entry;
}

export async function updateCostEntry(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = costEntrySchema.parse(data);
  const entry = await prisma.costEntry.update({
    where: { id },
    data: {
      ...parsed,
      date: new Date(parsed.date),
    },
  });
  revalidatePath("/cost");
  return entry;
}

export async function deleteCostEntry(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.costEntry.delete({ where: { id } });
  revalidatePath("/cost");
}

export async function getCostSummary() {
  const entries = await prisma.costEntry.findMany({
    include: { feature: true, goal: true, issue: true },
    orderBy: { date: "asc" },
  });

  // Compute labor costs from assignments
  const assignments = await prisma.assignment.findMany({
    where: { hoursActual: { gt: 0 } },
    include: { resource: true, feature: true, goal: true },
  });

  const laborCosts = assignments
    .filter((a) => a.resource.hourlyRate)
    .map((a) => ({
      date: a.weekStartDate,
      amount: a.hoursActual * (a.resource.hourlyRate || 0),
      featureName: a.feature?.title || null,
      goalName: a.goal?.title || null,
      resourceName: a.resource.name,
    }));

  return { entries, laborCosts };
}



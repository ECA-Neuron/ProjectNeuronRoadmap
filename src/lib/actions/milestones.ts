"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { milestoneSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getMilestones() {
  return prisma.milestone.findMany({
    orderBy: { date: "asc" },
    include: { initiative: { include: { workstream: true } } },
  });
}

export async function createMilestone(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = milestoneSchema.parse(data);
  await prisma.milestone.create({ data: parsed });
  revalidatePath("/roadmap");
  revalidatePath("/deliverables");
}

export async function deleteMilestone(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.milestone.delete({ where: { id } });
  revalidatePath("/roadmap");
}


"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getAssignments(month?: string) {
  return prisma.assignment.findMany({
    where: month ? { month } : {},
    include: {
      person: true,
      user: true,
      initiative: { include: { workstream: true } },
    },
    orderBy: { month: "desc" },
  });
}

export async function createAssignment(data: {
  personId?: string | null;
  userId?: string | null;
  initiativeId: string;
  month: string;
  hoursPlanned?: number;
  hoursActual?: number;
  notes?: string | null;
  outcome?: string | null;
}) {
  await requireRole(["ADMIN", "MEMBER"]);
  const assignment = await prisma.assignment.create({
    data: {
      personId: data.personId || null,
      userId: data.userId || null,
      initiativeId: data.initiativeId,
      month: data.month,
      hoursPlanned: data.hoursPlanned || 0,
      hoursActual: data.hoursActual || 0,
      notes: data.notes || null,
      outcome: data.outcome || null,
    },
  });
  revalidatePath("/assignments");
  revalidatePath("/people");
  revalidatePath("/dashboard");
  return assignment;
}

export async function updateAssignment(id: string, data: Partial<{
  personId: string | null;
  userId: string | null;
  initiativeId: string;
  month: string;
  hoursPlanned: number;
  hoursActual: number;
  notes: string | null;
  outcome: string | null;
}>) {
  await requireRole(["ADMIN", "MEMBER"]);
  const assignment = await prisma.assignment.update({
    where: { id },
    data,
  });
  revalidatePath("/assignments");
  return assignment;
}

export async function deleteAssignment(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.assignment.delete({ where: { id } });
  revalidatePath("/assignments");
}

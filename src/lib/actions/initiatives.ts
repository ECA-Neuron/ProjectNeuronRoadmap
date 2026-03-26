"use server";

import { prisma } from "@/lib/prisma";
import { initiativeSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth-helpers";

export async function getInitiatives(includeArchived = false) {
  return prisma.initiative.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: [{ workstreamId: "asc" }, { sortOrder: "asc" }],
    include: {
      workstream: true,
      milestones: { orderBy: { date: "asc" } },
      partnerLinks: { include: { partner: true } },
      artifacts: true,
      subTasks: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function getInitiative(id: string) {
  return prisma.initiative.findUnique({
    where: { id },
    include: {
      workstream: true,
      milestones: { orderBy: { date: "asc" } },
      partnerLinks: { include: { partner: true } },
      artifacts: true,
      assignments: { include: { person: true } },
      subTasks: { orderBy: { sortOrder: "asc" } },
      dependsOn: { include: { dependsOn: { include: { workstream: true } } } },
      dependedBy: { include: { initiative: { include: { workstream: true } } } },
    },
  });
}

export async function createInitiative(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = initiativeSchema.parse(data);
  const initiative = await prisma.initiative.create({
    data: {
      ...parsed,
      plannedStartMonth: parsed.plannedStartMonth || null,
      plannedEndMonth: parsed.plannedEndMonth || null,
      totalPoints: parsed.totalPoints || 0,
    },
  });
  revalidatePath("/roadmap");
  revalidatePath("/deliverables");
  revalidatePath("/workstreams");
  return initiative;
}

export async function updateInitiative(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = initiativeSchema.parse(data);
  const initiative = await prisma.initiative.update({
    where: { id },
    data: {
      ...parsed,
      plannedStartMonth: parsed.plannedStartMonth || null,
      plannedEndMonth: parsed.plannedEndMonth || null,
      totalPoints: parsed.totalPoints || 0,
    },
  });
  revalidatePath("/roadmap");
  revalidatePath("/deliverables");
  revalidatePath("/workstreams");
  return initiative;
}

export async function updateInitiativeField(
  id: string,
  field: string,
  value: string | number | boolean | null
) {
  await requireRole(["ADMIN", "MEMBER"]);
  const allowedFields = [
    "ownerInitials",
    "ownerId",
    "plannedStartMonth",
    "plannedEndMonth",
    "status",
    "totalPoints",
    "description",
    "name",
    "needsRefinement",
  ];
  if (!allowedFields.includes(field)) throw new Error(`Field ${field} not editable`);

  await prisma.initiative.update({
    where: { id },
    data: { [field]: value },
  });
  revalidatePath("/roadmap");
  revalidatePath("/deliverables");
  revalidatePath("/workstreams");
}

/** Set initiative owner from a Person (people tag). Syncs ownerInitials and ownerId so the dashboard shows it for the linked user. */
export async function updateInitiativeOwner(initiativeId: string, personId: string | null) {
  await requireRole(["ADMIN", "MEMBER"]);
  if (!personId) {
    await prisma.initiative.update({
      where: { id: initiativeId },
      data: { ownerInitials: null, ownerId: null },
    });
  } else {
    const person = await prisma.person.findUnique({ where: { id: personId }, select: { initials: true, userId: true } });
    if (!person) return;
    await prisma.initiative.update({
      where: { id: initiativeId },
      data: { ownerInitials: person.initials, ownerId: person.userId },
    });
  }
  revalidatePath("/roadmap");
  revalidatePath("/deliverables");
  revalidatePath("/workstreams");
  revalidatePath("/my-dashboard");
}

export async function archiveInitiative(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.initiative.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  revalidatePath("/roadmap");
  revalidatePath("/deliverables");
  revalidatePath("/workstreams");
}

export async function updateInitiativeDates(
  id: string,
  startMonth: string | null,
  endMonth: string | null
) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.initiative.update({
    where: { id },
    data: { plannedStartMonth: startMonth, plannedEndMonth: endMonth, needsRefinement: false },
  });
  revalidatePath("/roadmap");
  revalidatePath("/deliverables");
  revalidatePath("/workstreams");
}

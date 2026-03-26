// @ts-nocheck
"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { resourceSchema, teamSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getResources(includeArchived = false) {
  return prisma.resource.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    include: { team: true, user: true },
    orderBy: { name: "asc" },
  });
}

export async function createResource(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = resourceSchema.parse(data);
  const resource = await prisma.resource.create({
    data: {
      ...parsed,
      email: parsed.email || null,
      hourlyRate: parsed.hourlyRate ?? null,
    },
  });
  revalidatePath("/resources");
  return resource;
}

export async function updateResource(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = resourceSchema.parse(data);
  const resource = await prisma.resource.update({
    where: { id },
    data: {
      ...parsed,
      email: parsed.email || null,
      hourlyRate: parsed.hourlyRate ?? null,
    },
  });
  revalidatePath("/resources");
  return resource;
}

export async function archiveResource(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.resource.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  revalidatePath("/resources");
}

export async function getTeams() {
  return prisma.team.findMany({ orderBy: { name: "asc" } });
}

export async function createTeam(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = teamSchema.parse(data);
  const team = await prisma.team.create({ data: parsed });
  revalidatePath("/resources");
  revalidatePath("/admin");
  return team;
}



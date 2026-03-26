"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { programSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getProgram() {
  return prisma.program.findFirst({
    include: { workstreams: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function getPrograms() {
  return prisma.program.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      workstreams: {
        orderBy: { sortOrder: "asc" },
        include: {
          initiatives: {
            where: { archivedAt: null },
            include: { subTasks: true },
          },
        },
      },
      burnSnapshots: {
        orderBy: { date: "desc" },
        take: 1,
      },
    },
  });
}

export async function getProgramById(id: string) {
  return prisma.program.findUnique({
    where: { id },
    include: {
      workstreams: {
        orderBy: { sortOrder: "asc" },
        include: {
          initiatives: {
            where: { archivedAt: null },
            orderBy: { sortOrder: "asc" },
            include: { subTasks: true },
          },
        },
      },
      burnSnapshots: { orderBy: { date: "desc" }, take: 1 },
    },
  });
}

export async function createProgram(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = programSchema.parse(data);
  const program = await prisma.program.create({
    data: {
      name: parsed.name,
      mission: parsed.mission || null,
      vision: parsed.vision || null,
      successTenets: parsed.successTenets || null,
      objectives: parsed.objectives || null,
      fyStartYear: parsed.fyStartYear ?? 26,
      fyEndYear: parsed.fyEndYear ?? 28,
      status: "NOT_STARTED",
    },
  });
  revalidatePath("/roadmap");
  revalidatePath("/dashboard");
  revalidatePath("/workstreams");
  return program;
}

export async function updateProgram(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = programSchema.parse(data);
  const program = await prisma.program.update({ where: { id }, data: parsed });
  revalidatePath("/roadmap");
  revalidatePath("/dashboard");
  revalidatePath("/workstreams");
  return program;
}

export async function updateProgramField(
  id: string,
  field: string,
  value: string | number | boolean | null
) {
  await requireRole(["ADMIN", "MEMBER"]);
  const allowedFields = ["name", "status", "mission", "vision", "startDate", "targetDate"];
  if (!allowedFields.includes(field)) throw new Error(`Field ${field} not editable`);

  const data: Record<string, unknown> = {};
  if (field === "startDate" || field === "targetDate") {
    data[field] = value ? new Date(value as string) : null;
  } else {
    data[field] = value;
  }

  await prisma.program.update({ where: { id }, data });
  revalidatePath("/roadmap");
  revalidatePath("/dashboard");
}

export async function deleteProgram(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.program.delete({ where: { id } });
  revalidatePath("/roadmap");
  revalidatePath("/dashboard");
}

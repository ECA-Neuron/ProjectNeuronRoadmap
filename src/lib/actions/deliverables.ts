"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getDeliverables(workstreamId?: string) {
  return prisma.deliverable.findMany({
    where: workstreamId ? { workstreamId } : undefined,
    orderBy: { sortOrder: "asc" },
    include: {
      workstream: { select: { name: true, slug: true } },
      initiatives: {
        where: { archivedAt: null },
        orderBy: { sortOrder: "asc" },
      },
      _count: { select: { initiatives: true } },
    },
  });
}

export async function getDeliverable(id: string) {
  return prisma.deliverable.findUnique({
    where: { id },
    include: {
      workstream: true,
      initiatives: {
        where: { archivedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          subTasks: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
}

export async function createDeliverable(data: {
  workstreamId: string;
  name: string;
  description?: string;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  points?: number;
}) {
  await requireRole(["ADMIN", "MEMBER"]);
  const count = await prisma.deliverable.count({
    where: { workstreamId: data.workstreamId },
  });
  const del = await prisma.deliverable.create({
    data: {
      workstreamId: data.workstreamId,
      name: data.name,
      description: data.description,
      status: data.status ?? "NOT_STARTED",
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      points: data.points ?? 0,
      sortOrder: count,
    },
  });
  revalidatePath("/deliverables");
  revalidatePath("/timeline");
  revalidatePath("/dashboard");
  return del;
}

export async function updateDeliverable(
  id: string,
  data: {
    name?: string;
    description?: string;
    status?: string;
    startDate?: string | null;
    endDate?: string | null;
    points?: number;
  }
) {
  await requireRole(["ADMIN", "MEMBER"]);
  const del = await prisma.deliverable.update({
    where: { id },
    data: {
      ...data,
      startDate: data.startDate !== undefined
        ? (data.startDate ? new Date(data.startDate) : null)
        : undefined,
      endDate: data.endDate !== undefined
        ? (data.endDate ? new Date(data.endDate) : null)
        : undefined,
    },
  });
  revalidatePath("/deliverables");
  revalidatePath("/timeline");
  revalidatePath("/dashboard");
  return del;
}

export async function deleteDeliverable(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.deliverable.delete({ where: { id } });
  revalidatePath("/deliverables");
  revalidatePath("/timeline");
  revalidatePath("/dashboard");
}

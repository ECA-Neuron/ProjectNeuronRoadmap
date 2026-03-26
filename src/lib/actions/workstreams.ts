"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { workstreamSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getWorkstreams() {
  return prisma.workstream.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      initiatives: { where: { archivedAt: null }, orderBy: { sortOrder: "asc" } },
      _count: { select: { initiatives: true } },
    },
  });
}

export async function getWorkstream(slug: string) {
  return prisma.workstream.findFirst({
    where: { slug },
    include: {
      initiatives: {
        where: { archivedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          milestones: { orderBy: { date: "asc" } },
          partnerLinks: { include: { partner: true } },
          artifacts: true,
          dependsOn: { include: { dependsOn: true } },
        },
      },
      partnerLinks: { include: { partner: true } },
    },
  });
}

export async function createWorkstream(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = workstreamSchema.parse(data);
  const count = await prisma.workstream.count();
  const ws = await prisma.workstream.create({
    data: { ...parsed, sortOrder: count + 1 },
  });
  revalidatePath("/roadmap");
  revalidatePath("/workstreams");
  revalidatePath("/dashboard");
  revalidatePath("/burndown");
  return ws;
}

export async function updateWorkstream(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = workstreamSchema.parse(data);
  const ws = await prisma.workstream.update({ where: { id }, data: parsed });
  revalidatePath("/roadmap");
  revalidatePath("/workstreams");
  revalidatePath("/dashboard");
  revalidatePath("/burndown");
  revalidatePath(`/workstreams/${ws.slug}`);
  return ws;
}

export async function deleteWorkstream(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.workstream.delete({ where: { id } });
  revalidatePath("/roadmap");
  revalidatePath("/workstreams");
  revalidatePath("/dashboard");
  revalidatePath("/burndown");
}


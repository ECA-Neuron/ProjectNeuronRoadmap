"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { partnerSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getPartners() {
  return prisma.partner.findMany({
    orderBy: { name: "asc" },
    include: {
      workstreamLinks: { include: { workstream: true } },
      initiativeLinks: { include: { initiative: { include: { workstream: true } } } },
      artifacts: true,
    },
  });
}

export async function getPartner(id: string) {
  return prisma.partner.findUnique({
    where: { id },
    include: {
      workstreamLinks: { include: { workstream: true } },
      initiativeLinks: { include: { initiative: { include: { workstream: true } } } },
      artifacts: true,
    },
  });
}

export async function createPartner(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = partnerSchema.parse(data);
  await prisma.partner.create({ data: parsed });
  revalidatePath("/partners");
}

export async function updatePartner(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = partnerSchema.parse(data);
  await prisma.partner.update({ where: { id }, data: parsed });
  revalidatePath("/partners");
}

export async function deletePartner(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.partner.delete({ where: { id } });
  revalidatePath("/partners");
}


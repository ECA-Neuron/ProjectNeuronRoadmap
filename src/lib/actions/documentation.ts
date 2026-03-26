"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";

export async function getDocs(entityType?: string, entityId?: string) {
  return prisma.documentation.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(entityType === "PROGRAM" && entityId ? { programId: entityId } : {}),
      ...(entityType === "WORKSTREAM" && entityId ? { workstreamId: entityId } : {}),
      ...(entityType === "INITIATIVE" && entityId ? { initiativeId: entityId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
}

export async function getDoc(id: string) {
  return prisma.documentation.findUnique({
    where: { id },
    include: { author: { select: { id: true, name: true, email: true } } },
  });
}

export async function createDoc(data: {
  title: string;
  body: string;
  entityType: string;
  programId?: string | null;
  workstreamId?: string | null;
  initiativeId?: string | null;
  authorId?: string | null;
}) {
  await requireRole(["ADMIN", "MEMBER"]);
  const doc = await prisma.documentation.create({
    data: {
      title: data.title,
      body: data.body,
      entityType: data.entityType,
      programId: data.programId || null,
      workstreamId: data.workstreamId || null,
      initiativeId: data.initiativeId || null,
      authorId: data.authorId || null,
    },
  });
  revalidatePath("/docs");
  return doc;
}

export async function updateDoc(
  id: string,
  data: { title?: string; body?: string }
) {
  await requireRole(["ADMIN", "MEMBER"]);
  const doc = await prisma.documentation.update({
    where: { id },
    data,
  });
  revalidatePath("/docs");
  return doc;
}

export async function deleteDoc(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.documentation.delete({ where: { id } });
  revalidatePath("/docs");
}

export async function getAllDocs() {
  return prisma.documentation.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      author: { select: { id: true, name: true, email: true } },
      program: { select: { id: true, name: true } },
      workstream: { select: { id: true, name: true } },
      initiative: { select: { id: true, name: true } },
    },
  });
}

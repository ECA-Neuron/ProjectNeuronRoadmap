// @ts-nocheck
"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { issueSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";
export async function getIssues(includeArchived = false) {
  return prisma.issue.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    include: {
      feature: true,
      goal: true,
      owner: true,
      statusHistory: { orderBy: { changedAt: "desc" }, take: 10 },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getIssue(id: string) {
  return prisma.issue.findUnique({
    where: { id },
    include: {
      feature: true,
      goal: true,
      owner: true,
      statusHistory: { orderBy: { changedAt: "desc" } },
      assignments: { include: { resource: true } },
      costEntries: true,
    },
  });
}

export async function createIssue(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = issueSchema.parse(data);
  const issue = await prisma.issue.create({ data: parsed });
  revalidatePath("/issues");
  revalidatePath("/dashboard");
  return issue;
}

export async function updateIssue(id: string, data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = issueSchema.parse(data);
  const issue = await prisma.issue.update({ where: { id }, data: parsed });
  revalidatePath("/issues");
  return issue;
}

export async function changeIssueStatus(
  id: string,
  newStatus: string,
  userId?: string
) {
  await requireRole(["ADMIN", "MEMBER"]);
  const issue = await prisma.issue.findUniqueOrThrow({ where: { id } });
  const oldStatus = issue.status;

  await prisma.$transaction([
    prisma.issue.update({
      where: { id },
      data: { status: newStatus, updatedBy: userId },
    }),
    prisma.issueStatusHistory.create({
      data: {
        issueId: id,
        fromStatus: oldStatus,
        toStatus: newStatus,
        changedBy: userId,
      },
    }),
  ]);
  revalidatePath("/issues");
  revalidatePath("/dashboard");
}

export async function archiveIssue(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.issue.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  revalidatePath("/issues");
}



"use server";

import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { subTaskSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth-helpers";

export async function getSubTasks(initiativeId: string) {
  return prisma.subTask.findMany({
    where: { initiativeId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createSubTask(data: unknown) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = subTaskSchema.parse(data);
  const subTask = await prisma.subTask.create({
    data: {
      initiativeId: parsed.initiativeId,
      name: parsed.name,
      description: parsed.description || null,
      points: parsed.points || 0,
      completionPercent: parsed.completionPercent || 0,
      status: parsed.status || "NOT_STARTED",
      sortOrder: parsed.sortOrder || 0,
      estimatedDays: parsed.estimatedDays ?? null,
      unknowns: parsed.unknowns || null,
      integration: parsed.integration || null,
      ...(typeof parsed.assignedOrganization !== "undefined" && {
        assignedOrganization: parsed.assignedOrganization ?? null,
      }),
    } as Parameters<typeof prisma.subTask.create>[0]["data"],
  });
  revalidatePath("/workstreams");
  revalidatePath("/my-dashboard");
  return subTask;
}

export async function updateSubTask(id: string, data: Partial<{
  name: string;
  description: string | null;
  points: number;
  completionPercent: number;
  status: string;
  sortOrder: number;
  estimatedDays: number | null;
  unknowns: string | null;
  integration: string | null;
  assignedOrganization: string | null;
}>) {
  await requireRole(["ADMIN", "MEMBER"]);
  try {
    const subTask = await prisma.subTask.update({
      where: { id },
      data,
    });
    revalidatePath("/workstreams");
    revalidatePath("/my-dashboard");
    return subTask;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Unknown arg") && msg.includes("assignedOrganization")) {
      throw new Error(
        "Assigned organization not in Prisma client. In project root run: npx prisma generate"
      );
    }
    if ((msg.includes("assignedOrganization") || msg.includes("column")) && msg.includes("exist")) {
      throw new Error(
        "Assigned organization column missing in DB. Run: npx prisma db push"
      );
    }
    throw err;
  }
}

export async function updateSubTaskCompletion(
  id: string,
  completionPercent: number,
  reason?: string | null
) {
  await requireRole(["ADMIN", "MEMBER"]);
  const clamped = Math.max(0, Math.min(100, completionPercent));
  const status = clamped === 100 ? "DONE" : clamped > 0 ? "IN_PROGRESS" : "NOT_STARTED";
  const existing = await prisma.subTask.findUnique({ where: { id }, select: { completionPercent: true } });
  const previousPercent = existing?.completionPercent ?? 0;
  const subTask = await prisma.subTask.update({
    where: { id },
    data: { completionPercent: clamped, status },
  });
  // Create a note when percent changed and/or user provided a comment. Never throw so subtask update always succeeds.
  const percentChanged = previousPercent !== clamped;
  const reasonStr = (reason != null && reason.trim() !== "") ? reason.trim() : "";
  const shouldCreateNote = percentChanged || reasonStr !== "";
  if (shouldCreateNote) {
    const baseData = {
      subTaskId: id,
      previousPercent,
      newPercent: clamped,
      reason: reasonStr,
    };
    try {
      await (prisma as any).subTaskCompletionNote.create({ data: baseData });
    } catch (noteErr) {
      const msg = noteErr instanceof Error ? noteErr.message : String(noteErr);
      if (msg.includes("userId") || msg.includes("Unknown arg") || msg.includes("does not exist")) {
        try {
          const noteId = randomUUID();
          await prisma.$executeRaw`
            INSERT INTO "SubTaskCompletionNote" (id, "subTaskId", "previousPercent", "newPercent", reason, "createdAt")
            VALUES (${noteId}, ${id}, ${previousPercent}, ${clamped}, ${reasonStr}, now())
          `;
        } catch {
          // Table/columns may differ in production; skip note so save still succeeds
        }
      } else {
        throw noteErr;
      }
    }
  }
  revalidatePath("/workstreams");
  revalidatePath("/my-dashboard");
  return subTask;
}

export async function updateSubTaskEstimation(
  id: string,
  data: {
    estimatedDays?: number | null;
    unknowns?: string | null;
    integration?: string | null;
    points?: number;
  }
) {
  await requireRole(["ADMIN", "MEMBER"]);
  const subTask = await prisma.subTask.update({
    where: { id },
    data,
  });
  revalidatePath("/workstreams");
  revalidatePath("/my-dashboard");
  return subTask;
}

export async function toggleSubTaskAddedScope(id: string, isAddedScope: boolean) {
  await requireRole(["ADMIN", "MEMBER"]);
  const subTask = await prisma.subTask.update({
    where: { id },
    data: { isAddedScope },
  });
  revalidatePath("/workstreams");
  revalidatePath("/burndown");
  revalidatePath("/my-dashboard");
  return subTask;
}

export async function updateSubTaskAssignee(id: string, assigneeId: string | null) {
  await requireRole(["ADMIN", "MEMBER"]);
  const subTask = await prisma.subTask.update({
    where: { id },
    data: { assigneeId },
  });
  revalidatePath("/workstreams");
  revalidatePath("/my-dashboard");
  return subTask;
}

export async function deleteSubTask(id: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  await prisma.subTask.delete({ where: { id } });
  revalidatePath("/workstreams");
  revalidatePath("/my-dashboard");
}

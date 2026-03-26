"use server";

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { revalidatePath } from "next/cache";
import { getCurrentPeriod } from "@/lib/burn-periods";

/**
 * Get all burn snapshots for a program.
 */
export async function getBurnSnapshots(
  programId: string,
  dateFrom?: string,
  dateTo?: string
) {
  return prisma.burnSnapshot.findMany({
    where: {
      programId,
      ...(dateFrom || dateTo
        ? {
            date: {
              ...(dateFrom ? { gte: dateFrom } : {}),
              ...(dateTo ? { lte: dateTo } : {}),
            },
          }
        : {}),
    },
    orderBy: { date: "asc" },
  });
}

/**
 * Create or update a snapshot for a given program on a specific date key.
 * Idempotent per (programId, date): upserts.
 */
export async function saveSnapshot(
  programId: string,
  date: string,
  totalPoints: number,
  completedPoints: number,
  workstreamData?: Record<string, {
    name: string;
    totalPoints: number;
    completedPoints: number;
    subcomponents?: Record<string, { name: string; totalPoints: number; completedPoints: number }>;
  }>
) {
  await requireRole(["ADMIN", "MEMBER"]);
  const percentComplete = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;

  const snapshot = await prisma.burnSnapshot.upsert({
    where: {
      programId_date: { programId, date },
    },
    create: {
      programId,
      date,
      totalPoints,
      completedPoints,
      percentComplete,
      workstreamData: workstreamData ?? undefined,
    },
    update: {
      totalPoints,
      completedPoints,
      percentComplete,
      workstreamData: workstreamData ?? undefined,
    },
  });

  revalidatePath("/burndown");
  revalidatePath("/dashboard");
  revalidatePath("/workstreams");
  revalidatePath("/roadmap");
  return snapshot;
}

/**
 * Compute live totals for a program and save as the current month's snapshot.
 * Uses completionPercent for partial progress.
 * Stores per-workstream AND per-subcomponent breakdowns.
 * Can only save for the CURRENT month.
 */
export async function saveMonthlySnapshot(programId: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  const period = getCurrentPeriod();

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      workstreams: {
        include: {
          initiatives: {
            where: { archivedAt: null },
            include: { subTasks: true },
          },
        },
      },
    },
  });

  if (!program) throw new Error("Program not found");

  let totalPoints = 0;
  let completedPoints = 0;

  const wsData: Record<string, {
    name: string;
    totalPoints: number;
    completedPoints: number;
    subcomponents: Record<string, { name: string; totalPoints: number; completedPoints: number }>;
  }> = {};

  for (const ws of program.workstreams) {
    let wsTotalPts = 0;
    let wsCompletedPts = 0;
    const subcomponents: Record<string, { name: string; totalPoints: number; completedPoints: number }> = {};

    for (const init of ws.initiatives) {
      let initTotalPts = 0;
      let initCompletedPts = 0;

      for (const st of init.subTasks) {
        const stPts = st.points;
        const stCompleted = Math.round(stPts * (st.completionPercent / 100));

        initTotalPts += stPts;
        initCompletedPts += stCompleted;
        wsTotalPts += stPts;
        wsCompletedPts += stCompleted;
        totalPoints += stPts;
        completedPoints += stCompleted;
      }

      subcomponents[init.id] = {
        name: init.name,
        totalPoints: initTotalPts,
        completedPoints: initCompletedPts,
      };
    }

    wsData[ws.id] = {
      name: ws.name,
      totalPoints: wsTotalPts,
      completedPoints: wsCompletedPts,
      subcomponents,
    };
  }

  return saveSnapshot(programId, period.dateKey, totalPoints, completedPoints, wsData);
}

/** Backward-compat aliases */
export async function saveBiweeklySnapshot(programId: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  return saveMonthlySnapshot(programId);
}
export async function saveSnapshotForToday(programId: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  return saveMonthlySnapshot(programId);
}

/**
 * Get the latest snapshot for a program.
 */
export async function getLatestSnapshot(programId: string) {
  return prisma.burnSnapshot.findFirst({
    where: { programId },
    orderBy: { date: "desc" },
  });
}

/**
 * Get all snapshots across all programs.
 */
export async function getAllSnapshots() {
  return prisma.burnSnapshot.findMany({
    orderBy: [{ programId: "asc" }, { date: "asc" }],
    include: { program: { select: { id: true, name: true } } },
  });
}

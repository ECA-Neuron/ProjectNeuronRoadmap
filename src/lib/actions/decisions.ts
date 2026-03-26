// @ts-nocheck
"use server";

import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { decisionLogSchema } from "@/lib/validations";
import { revalidatePath } from "next/cache";

export async function getDecisionLogs(featureId?: string, goalId?: string, themeId?: string) {
  return prisma.decisionLog.findMany({
    where: {
      ...(featureId ? { featureId } : {}),
      ...(goalId ? { goalId } : {}),
      ...(themeId ? { themeId } : {}),
    },
    include: { author: true, feature: true, goal: true, theme: true },
    orderBy: { date: "desc" },
  });
}

export async function createDecisionLog(data: unknown, userId?: string) {
  await requireRole(["ADMIN", "MEMBER"]);
  const parsed = decisionLogSchema.parse(data);
  const log = await prisma.decisionLog.create({
    data: {
      ...parsed,
      madeBy: userId,
    },
  });
  revalidatePath("/features");
  revalidatePath("/goals");
  revalidatePath("/roadmap");
  return log;
}



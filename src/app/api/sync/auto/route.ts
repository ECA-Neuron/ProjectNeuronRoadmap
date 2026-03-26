import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runPullOnly, runPushOnly } from "@/lib/sync/roadmap-sync";

export const dynamic = "force-dynamic";

const PULL_STALE_MS = 2 * 60 * 1000; // 2 minutes
const PUSH_STALE_MS = 5 * 60 * 1000; // 5 minutes

// In-memory lock to prevent concurrent syncs within the same server process
let syncInProgress = false;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();

  const lastPull = await prisma.syncLog.findFirst({
    where: {
      status: { in: ["SUCCESS", "PARTIAL"] },
      direction: { in: ["PULL", "BIDIRECTIONAL"] },
    },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });

  const lastPush = await prisma.syncLog.findFirst({
    where: {
      status: { in: ["SUCCESS", "PARTIAL"] },
      direction: { in: ["PUSH", "BIDIRECTIONAL"] },
    },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });

  const lastPullAt = lastPull?.completedAt?.getTime() ?? 0;
  const lastPushAt = lastPush?.completedAt?.getTime() ?? 0;
  const pullStale = now - lastPullAt > PULL_STALE_MS;
  const pushStale = now - lastPushAt > PUSH_STALE_MS;

  if (!pullStale && !pushStale) {
    return NextResponse.json({
      syncing: false,
      lastPulledAt: lastPull?.completedAt?.toISOString() ?? null,
      lastPushedAt: lastPush?.completedAt?.toISOString() ?? null,
      fresh: true,
    });
  }

  if (syncInProgress) {
    return NextResponse.json({
      syncing: true,
      lastPulledAt: lastPull?.completedAt?.toISOString() ?? null,
      lastPushedAt: lastPush?.completedAt?.toISOString() ?? null,
      fresh: false,
    });
  }

  syncInProgress = true;

  try {
    let pullSynced = 0;
    let pushSynced = 0;

    if (pullStale) {
      const result = await runPullOnly("AUTO");
      pullSynced = result.pullResult.synced;
    }

    if (pushStale) {
      const result = await runPushOnly("AUTO");
      pushSynced = result.pushResult.synced;
    }

    const updatedPull = await prisma.syncLog.findFirst({
      where: { status: { in: ["SUCCESS", "PARTIAL"] }, direction: { in: ["PULL", "BIDIRECTIONAL"] } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    });

    const updatedPush = await prisma.syncLog.findFirst({
      where: { status: { in: ["SUCCESS", "PARTIAL"] }, direction: { in: ["PUSH", "BIDIRECTIONAL"] } },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    });

    return NextResponse.json({
      syncing: false,
      lastPulledAt: updatedPull?.completedAt?.toISOString() ?? null,
      lastPushedAt: updatedPush?.completedAt?.toISOString() ?? null,
      fresh: true,
      pullSynced,
      pushSynced,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { syncing: false, error: msg, fresh: false },
      { status: 500 }
    );
  } finally {
    syncInProgress = false;
  }
}

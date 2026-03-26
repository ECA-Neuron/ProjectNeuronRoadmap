import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runSync } from "@/lib/sync/roadmap-sync";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session || role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const syncType =
    body.syncType === "SCHEDULED" ? "SCHEDULED" : "MANUAL";

  try {
    const result = await runSync(syncType as "MANUAL" | "SCHEDULED");
    return NextResponse.json({
      success: true,
      syncLogId: result.syncLogId,
      pulled: result.pullResult.synced,
      pushed: result.pushResult.synced,
      errors: [
        ...result.pullResult.errors,
        ...result.pushResult.errors,
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session || role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const logs = await prisma.syncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
  });

  return NextResponse.json({ logs });
}

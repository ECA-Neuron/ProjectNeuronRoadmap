import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync/roadmap-sync";

/**
 * Scheduled sync endpoint — hit by an external cron service.
 * Protected by a shared secret in the Authorization header.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET}`;

  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const result = await runSync("SCHEDULED");
    return NextResponse.json({
      success: true,
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

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pullOpenIssues, pushOpenIssues } from "@/lib/sync/open-issues-sync";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const direction = body.direction as string;

  if (direction !== "pull" && direction !== "push") {
    return NextResponse.json({ error: "direction must be 'pull' or 'push'" }, { status: 400 });
  }

  try {
    if (direction === "pull") {
      const result = await pullOpenIssues();
      return NextResponse.json({
        success: true,
        direction: "pull",
        synced: result.synced,
        errors: result.errors,
      });
    } else {
      const result = await pushOpenIssues();
      return NextResponse.json({
        success: true,
        direction: "push",
        synced: result.synced,
        errors: result.errors,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[open-issues-sync] Error:", msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

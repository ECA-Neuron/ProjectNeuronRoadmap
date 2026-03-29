import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runPullOnly, runPushOnly } from "@/lib/sync/roadmap-sync";
import { pullOpenIssues, pushOpenIssues } from "@/lib/sync/open-issues-sync";

let syncInProgress = false;

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

  if (syncInProgress) {
    return NextResponse.json({ error: "Sync already in progress" }, { status: 409 });
  }

  syncInProgress = true;

  try {
    if (direction === "pull") {
      const result = await runPullOnly("MANUAL");
      let issuesSynced = 0;
      const issueErrors: string[] = [];
      try {
        const issueResult = await pullOpenIssues();
        issuesSynced = issueResult.synced;
        issueErrors.push(...issueResult.errors);
      } catch (e) {
        issueErrors.push(`Open issues pull failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return NextResponse.json({
        success: true,
        direction: "pull",
        synced: result.pullResult.synced + issuesSynced,
        errors: [...result.pullResult.errors, ...issueErrors],
      });
    } else {
      const result = await runPushOnly("MANUAL");
      let issuesSynced = 0;
      const issueErrors: string[] = [];
      try {
        const issueResult = await pushOpenIssues();
        issuesSynced = issueResult.synced;
        issueErrors.push(...issueResult.errors);
      } catch (e) {
        issueErrors.push(`Open issues push failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return NextResponse.json({
        success: true,
        direction: "push",
        synced: result.pushResult.synced + issuesSynced,
        errors: [...result.pushResult.errors, ...issueErrors],
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  } finally {
    syncInProgress = false;
  }
}

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Runs prisma db push at runtime (when the database IS reachable).
 * Admin-only. Hit this once after deploy to apply schema changes.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session || role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { stdout, stderr } = await execAsync(
      "npx prisma db push --accept-data-loss --skip-generate",
      { timeout: 30000 }
    );
    return NextResponse.json({
      success: true,
      output: stdout + (stderr ? `\n${stderr}` : ""),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

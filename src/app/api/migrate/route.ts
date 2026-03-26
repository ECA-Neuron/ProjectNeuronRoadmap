import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Runs prisma db push at runtime (when the database IS reachable).
 * Protected by NEXTAUTH_SECRET as a query param.
 *
 * Usage: GET /api/migrate?secret=<NEXTAUTH_SECRET>
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.NEXTAUTH_SECRET;

  if (!secret || !expected || secret !== expected) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 403 });
  }

  try {
    const { stdout, stderr } = await execAsync(
      "npx prisma db push --accept-data-loss --skip-generate",
      { timeout: 60000 }
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

export async function POST() {
  try {
    const { stdout, stderr } = await execAsync(
      "npx prisma db push --accept-data-loss --skip-generate",
      { timeout: 60000 }
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

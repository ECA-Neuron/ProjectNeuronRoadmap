import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listDatabases, discoverDatabase } from "@/lib/notion/discover";

export const dynamic = "force-dynamic";

const REQUIRED_DBS = [
  "Neuron Workstreams Roadmap",
  "Roadmap Progress Log",
  "Open Issues",
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const allDbs = await listDatabases();

    const checks = await Promise.all(
      REQUIRED_DBS.map(async (name) => {
        const found = await discoverDatabase(name);
        return { name, found: !!found, dbId: found?.id ?? null, dbTitle: found?.title ?? null };
      })
    );

    return NextResponse.json({
      accessibleDatabases: allDbs,
      requiredChecks: checks,
      allConnected: checks.every((c) => c.found),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

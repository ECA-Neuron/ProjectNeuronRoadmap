import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listDatabases, discoverDatabase } from "@/lib/notion/discover";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const allDbs = await listDatabases();
    const openIssuesDb = await discoverDatabase("Open Issues");

    return NextResponse.json({
      allDatabases: allDbs,
      openIssuesMatch: openIssuesDb ? {
        id: openIssuesDb.id,
        title: openIssuesDb.title,
        properties: Object.entries(openIssuesDb.properties).map(([k, v]) => ({
          name: k,
          type: v.type,
        })),
      } : null,
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}

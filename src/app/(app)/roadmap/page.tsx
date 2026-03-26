import { prisma } from "@/lib/prisma";
import { serializeForClient } from "@/lib/serialize";
import { GanttRoadmap } from "./gantt-roadmap";

export const dynamic = "force-dynamic";

export default async function RoadmapPage() {
  let programs: Awaited<ReturnType<typeof prisma.program.findMany>> = [];
  let workstreams: Awaited<ReturnType<typeof prisma.workstream.findMany>> = [];
  let people: Awaited<ReturnType<typeof prisma.person.findMany>> = [];

  try {
    [programs, workstreams, people] = await Promise.all([
      prisma.program.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          burnSnapshots: { orderBy: { date: "desc" }, take: 1 },
          workstreams: {
            orderBy: { sortOrder: "asc" },
            include: {
              initiatives: {
                where: { archivedAt: null },
                include: { subTasks: true },
              },
            },
          },
        },
      }),
      prisma.workstream.findMany({
        orderBy: { sortOrder: "asc" },
        include: {
          initiatives: {
            where: { archivedAt: null },
            orderBy: { sortOrder: "asc" },
            include: {
              milestones: true,
              partnerLinks: { include: { partner: true } },
              subTasks: true,
            },
          },
        },
      }),
      prisma.person.findMany({ orderBy: { name: "asc" } }),
    ]) as any;
  } catch (err) {
    console.error("Roadmap data load error:", err);
  }

  const programsWithStats = (programs as any[]).map((p: any) => {
    let totalPts = 0;
    let completedPts = 0;
    for (const ws of p.workstreams ?? []) {
      for (const init of ws.initiatives ?? []) {
        for (const st of init.subTasks ?? []) {
          totalPts += st.points;
          if (st.status === "DONE") completedPts += st.points;
        }
      }
    }
    const currentPct = totalPts > 0 ? Math.round((completedPts / totalPts) * 100) : 0;
    const lastSnapshot = p.burnSnapshots?.[0] || null;
    const savedPct = lastSnapshot ? Math.round(lastSnapshot.percentComplete) : 0;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      totalPts,
      completedPts,
      currentPct,
      savedPct,
      lastSnapshotDate: lastSnapshot?.date || null,
    };
  });

  const data = (workstreams as any[]).map((ws: any) => ({ ...ws, programId: ws.programId }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Roadmap</h1>
        <p className="text-muted-foreground mt-1">FY26 – FY28 Program Timeline by Workstream. Click <strong>+ Add initiative</strong> next to a workstream name to add an initiative there, or <strong>+ New Workstream</strong> to add a new section (e.g. Connectors, Kit Applications).</p>
      </div>
      <GanttRoadmap
        workstreams={serializeForClient(data)}
        people={serializeForClient(people)}
        programs={serializeForClient(programsWithStats)}
      />
    </div>
  );
}

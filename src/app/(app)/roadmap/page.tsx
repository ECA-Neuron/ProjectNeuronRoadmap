import { prisma } from "@/lib/prisma";
import { serializeForClient } from "@/lib/serialize";
import { RoadmapTabs } from "./roadmap-tabs";

export const dynamic = "force-dynamic";

export default async function RoadmapPage() {
  let workstreams: any[] = [];
  let people: any[] = [];
  let progressLogs: any[] = [];
  let dependencies: { initiativeId: string; dependsOnId: string }[] = [];

  try {
    [workstreams, people, progressLogs, dependencies] = await Promise.all([
      prisma.workstream.findMany({
        orderBy: { name: "asc" },
        include: {
          deliverables: {
            orderBy: { sortOrder: "asc" },
            include: {
              initiatives: {
                where: { archivedAt: null },
                orderBy: { sortOrder: "asc" },
                include: {
                  subTasks: {
                    orderBy: { sortOrder: "asc" },
                    include: {
                      assignee: { select: { id: true, name: true, initials: true } },
                    },
                  },
                },
              },
            },
          },
          initiatives: {
            where: { archivedAt: null, deliverableId: null },
            orderBy: { sortOrder: "asc" },
            include: {
              subTasks: {
                orderBy: { sortOrder: "asc" },
                include: {
                  assignee: { select: { id: true, name: true, initials: true } },
                },
              },
            },
          },
        },
      }),
      prisma.person.findMany({
        where: { initials: { not: null } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, initials: true },
      }).then(all => {
        const seen = new Set<string>();
        return all.filter(p => {
          if (!p.initials || p.initials.length < 2) return false;
          if (seen.has(p.initials)) return false;
          seen.add(p.initials);
          return true;
        });
      }),
      prisma.progressLog.findMany({
        orderBy: { logDate: "asc" },
        select: {
          id: true,
          taskName: true,
          percentComplete: true,
          totalPoints: true,
          currentPoints: true,
          addedPoints: true,
          scopeStatus: true,
          logDate: true,
          completedBy: true,
          subTaskId: true,
          initiativeId: true,
          deliverableId: true,
          workstreamId: true,
          updateComment: true,
        },
      }),
      prisma.initiativeDependency.findMany({
        select: { initiativeId: true, dependsOnId: true },
      }),
    ]);
  } catch (err) {
    console.error("Roadmap data load error:", err);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roadmap</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Plan, track, and manage workstreams, deliverables, features, and tasks.
        </p>
      </div>
      <RoadmapTabs
        workstreams={serializeForClient(workstreams) as any}
        people={serializeForClient(people) as any}
        progressLogs={serializeForClient(progressLogs) as any}
        dependencies={dependencies}
      />
    </div>
  );
}

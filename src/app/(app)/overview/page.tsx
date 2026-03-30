import { prisma } from "@/lib/prisma";
import { serializeForClient } from "@/lib/serialize";
import { OverviewDashboard } from "./overview-dashboard";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  try {
    const [workstreams, openIssues, recentLogs, allProgressLogs] = await Promise.all([
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
                    select: {
                      id: true, name: true, status: true, points: true,
                      completionPercent: true, startDate: true, endDate: true,
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
                select: {
                  id: true, name: true, status: true, points: true,
                  completionPercent: true, startDate: true, endDate: true,
                  assignee: { select: { id: true, name: true, initials: true } },
                },
              },
            },
          },
        },
      }),
      prisma.openIssue.findMany({
        where: { resolvedAt: null },
        include: {
          workstream: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.progressLog.findMany({
        orderBy: { logDate: "desc" },
        take: 20,
        select: {
          id: true, taskName: true, updateComment: true, completedBy: true,
          logDate: true, percentComplete: true, currentPoints: true, totalPoints: true,
          subTask: { select: { name: true } },
          initiative: { select: { name: true } },
          workstream: { select: { name: true } },
        },
      }),
      prisma.progressLog.findMany({
        orderBy: { logDate: "asc" },
        select: {
          id: true, taskName: true, logDate: true, totalPoints: true, currentPoints: true,
          percentComplete: true, updateComment: true, completedBy: true,
          workstreamId: true, deliverableId: true, initiativeId: true, subTaskId: true,
          subTask: { select: { name: true } },
          initiative: { select: { name: true } },
        },
      }),
    ]);

    return (
      <OverviewDashboard
        workstreams={serializeForClient(workstreams) as any}
        openIssues={serializeForClient(openIssues) as any}
        recentLogs={serializeForClient(recentLogs) as any}
        progressLogs={serializeForClient(allProgressLogs) as any}
      />
    );
  } catch (err) {
    console.error("Overview page error:", err);
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-xl border border-destructive/50 bg-card p-6 space-y-3">
          <h2 className="text-lg font-semibold text-destructive">Overview failed to load</h2>
          <p className="text-sm text-muted-foreground">
            {err instanceof Error ? err.message : "Unknown error"} — check Render logs for details.
          </p>
        </div>
      </div>
    );
  }
}

import { prisma } from "@/lib/prisma";
import { serializeForClient } from "@/lib/serialize";
import BurndownView from "./burndown-view";

export const dynamic = "force-dynamic";

export default async function BurndownPage() {
  const [workstreams, progressLogs] = await Promise.all([
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
                subTasks: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        },
        initiatives: {
          where: { archivedAt: null, deliverableId: null },
          orderBy: { sortOrder: "asc" },
          include: {
            subTasks: { orderBy: { sortOrder: "asc" } },
          },
        },
      },
    }),
    prisma.progressLog.findMany({
      orderBy: { logDate: "asc" },
      select: {
        id: true,
        taskName: true,
        totalPoints: true,
        currentPoints: true,
        percentComplete: true,
        updateComment: true,
        completedBy: true,
        logDate: true,
        workstreamId: true,
        deliverableId: true,
        initiativeId: true,
        subTaskId: true,
        subTask: { select: { name: true } },
        initiative: { select: { name: true } },
      },
    }),
  ]);

  return (
    <BurndownView
      workstreams={serializeForClient(workstreams) as any}
      progressLogs={serializeForClient(progressLogs) as any}
    />
  );
}

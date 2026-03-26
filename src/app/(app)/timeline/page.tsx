import { prisma } from "@/lib/prisma";
import { serializeForClient } from "@/lib/serialize";
import { requireAuth } from "@/lib/auth-helpers";
import { TimelineView } from "./timeline-view";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  await requireAuth();

  const workstreams = await prisma.workstream.findMany({
    orderBy: { sortOrder: "asc" },
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
                  id: true,
                  name: true,
                  status: true,
                  startDate: true,
                  endDate: true,
                  points: true,
                  estimatedDays: true,
                  completionPercent: true,
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
              id: true,
              name: true,
              status: true,
              startDate: true,
              endDate: true,
              points: true,
              estimatedDays: true,
              completionPercent: true,
            },
          },
        },
      },
    },
  });

  return <TimelineView workstreams={serializeForClient(workstreams) as unknown as Parameters<typeof TimelineView>[0]["workstreams"]} />;
}

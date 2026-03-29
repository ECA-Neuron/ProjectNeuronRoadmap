import { prisma } from "@/lib/prisma";
import { serializeForClient } from "@/lib/serialize";
import { AddTaskView } from "./add-task-view";

export const dynamic = "force-dynamic";

export default async function AddTaskPage() {
  const [workstreams, people] = await Promise.all([
    prisma.workstream.findMany({
      orderBy: { name: "asc" },
      include: {
        deliverables: {
          orderBy: { sortOrder: "asc" },
          include: {
            initiatives: {
              where: { archivedAt: null },
              orderBy: { sortOrder: "asc" },
              include: { subTasks: { orderBy: { sortOrder: "asc" } } },
            },
          },
        },
        initiatives: {
          where: { archivedAt: null, deliverableId: null },
          orderBy: { sortOrder: "asc" },
          include: { subTasks: { orderBy: { sortOrder: "asc" } } },
        },
      },
    }),
    prisma.person.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return <AddTaskView workstreams={serializeForClient(workstreams)} people={people} />;
}

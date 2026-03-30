import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeForClient } from "@/lib/serialize";
import { MyDashboardClient } from "./my-dashboard-client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MyDashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/signin");

  const userName = session.user.name ?? "";
  const userEmail = session.user.email ?? "";

  const userInitials = userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  let person: Awaited<ReturnType<typeof prisma.person.findFirst>> = null;
  let subTasks: any[] = [];
  let initiatives: any[] = [];
  let myOpenIssues: any[] = [];
  let myProgressLogs: any[] = [];
  let workstreams: any[] = [];

  try {
    person = await prisma.person.findFirst({
      where: {
        OR: [
          { user: { email: userEmail } },
          { name: { equals: userName, mode: "insensitive" } },
        ],
      },
    });

    subTasks = person
      ? await prisma.subTask.findMany({
          where: { assigneeId: person.id },
          include: {
            initiative: {
              include: {
                workstream: { select: { id: true, name: true } },
                deliverable: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        })
      : [];

    initiatives = await prisma.initiative.findMany({
      where: {
        OR: [
          { ownerInitials: { equals: userName, mode: "insensitive" } },
          { ownerInitials: { equals: userInitials, mode: "insensitive" } },
          ...(person
            ? [{ subTasks: { some: { assigneeId: person.id } } }]
            : []),
        ],
      },
      include: {
        workstream: { select: { id: true, name: true } },
        deliverable: { select: { id: true, name: true } },
        subTasks: {
          include: {
            assignee: { select: { id: true, name: true, initials: true } },
          },
        },
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });

    myOpenIssues = person
      ? await prisma.openIssue.findMany({
          where: {
            resolvedAt: null,
            OR: [
              { assignees: { some: { personId: person.id } } },
              { comments: { some: { mentions: { some: { personId: person.id } } } } },
            ],
          },
          include: {
            workstream: { select: { id: true, name: true } },
            subTask: { select: { id: true, name: true } },
            assignees: { include: { person: { select: { id: true, name: true, initials: true } } } },
          },
          orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        })
      : [];

    const allMySubTaskIds = new Set(subTasks.map((t: any) => t.id));
    for (const init of initiatives) {
      for (const st of (init as any).subTasks) allMySubTaskIds.add(st.id);
    }
    const myTaskIds = [...allMySubTaskIds];
    const myFeatureIds = initiatives.map((i: any) => i.id);

    myProgressLogs = (myTaskIds.length > 0 || myFeatureIds.length > 0)
      ? await prisma.progressLog.findMany({
          where: {
            OR: [
              ...(myTaskIds.length > 0 ? [{ subTaskId: { in: myTaskIds as string[] } }] : []),
              ...(myFeatureIds.length > 0 ? [{ initiativeId: { in: myFeatureIds as string[] } }] : []),
            ],
          },
          orderBy: { logDate: "asc" },
          select: {
            id: true,
            taskName: true,
            logDate: true,
            percentComplete: true,
            currentPoints: true,
            totalPoints: true,
            updateComment: true,
            completedBy: true,
            subTaskId: true,
            initiativeId: true,
          },
        })
      : [];

    workstreams = await prisma.workstream.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        deliverables: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            initiatives: {
              where: { archivedAt: null },
              orderBy: { sortOrder: "asc" },
              select: { id: true, name: true },
            },
          },
        },
        initiatives: {
          where: { archivedAt: null, deliverableId: null },
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true },
        },
      },
    });
  } catch (err) {
    console.error("My Dashboard data fetch error:", err);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tasks and features assigned to{" "}
          <span className="font-semibold text-foreground">{userName}</span>
        </p>
      </div>
      <MyDashboardClient
        userName={userName}
        tasks={serializeForClient(subTasks) as any}
        features={serializeForClient(initiatives) as any}
        openIssues={serializeForClient(myOpenIssues) as any}
        progressLogs={serializeForClient(myProgressLogs) as any}
        workstreams={serializeForClient(workstreams) as any}
      />
    </div>
  );
}

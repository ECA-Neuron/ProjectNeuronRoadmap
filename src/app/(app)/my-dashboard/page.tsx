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

  // Compute initials for matching (e.g., "Jacky Chen" → "JC")
  const userInitials = userName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  // Find the user's Person record (linked via name match)
  const person = await prisma.person.findFirst({
    where: {
      OR: [
        { user: { email: userEmail } },
        { name: { equals: userName, mode: "insensitive" } },
      ],
    },
  });

  // Fetch tasks assigned to this person
  const subTasks = person
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

  // Fetch initiatives/features owned by this user (match full name OR initials)
  const initiatives = await prisma.initiative.findMany({
    where: {
      OR: [
        { ownerInitials: { equals: userName, mode: "insensitive" } },
        { ownerInitials: { equals: userInitials, mode: "insensitive" } },
        // Also include parent features of the user's tasks
        ...(person
          ? [{ subTasks: { some: { assigneeId: person.id } } }]
          : []),
      ],
    },
    include: {
      workstream: { select: { id: true, name: true } },
      deliverable: { select: { id: true, name: true } },
      subTasks: true,
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  const myOpenIssues = person
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
        orderBy: [
          { severity: "asc" },
          { createdAt: "desc" },
        ],
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">My Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Tasks and features assigned to{" "}
          <span className="font-semibold text-foreground">{userName}</span>
        </p>
      </div>
      <MyDashboardClient
        userName={userName}
        tasks={serializeForClient(subTasks) as any}
        features={serializeForClient(initiatives) as any}
        openIssues={serializeForClient(myOpenIssues) as any}
      />
    </div>
  );
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { serializeForClient } from "@/lib/serialize";
import { OpenIssuesPageClient } from "./open-issues-client";

export const dynamic = "force-dynamic";

export default async function OpenIssuesPage() {
  const session = await getServerSession(authOptions);
  let currentPersonId: string | null = null;
  if (session?.user) {
    const userId = (session.user as { id?: string }).id ?? null;
    if (userId) {
      const person = await prisma.person.findUnique({ where: { userId }, select: { id: true } });
      if (person) currentPersonId = person.id;
    }
    if (!currentPersonId && (session.user as { email?: string }).email) {
      const u = await prisma.user.findUnique({
        where: { email: (session.user as { email: string }).email },
        select: { id: true },
      });
      if (u) {
        const person = await prisma.person.findUnique({ where: { userId: u.id }, select: { id: true } });
        if (person) currentPersonId = person.id;
      }
    }
  }

  const workstreams = await prisma.workstream.findMany({
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      initiatives: {
        where: { archivedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          subTasks: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  let issues: Array<{
    id: string;
    workstreamId: string;
    subTaskId: string | null;
    title: string;
    description: string | null;
    severity: string;
    screenshotUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
    resolvedAt: Date | null;
    workstream: { id: string; name: string; slug: string };
    subTask: { id: string; name: string; initiative: { id: string; name: string } } | null;
    assignees: Array<{ person: { id: string; name: string; initials: string | null } }>;
    comments: Array<unknown>;
  }>;
  let people: Array<{ id: string; name: string; initials: string | null }>;

  try {
    const [issuesResult, peopleResult] = await Promise.all([
      prisma.openIssue.findMany({
        include: {
          workstream: { select: { id: true, name: true, slug: true } },
          subTask: {
            select: {
              id: true,
              name: true,
              initiative: { select: { id: true, name: true } },
            },
          },
          assignees: { include: { person: { select: { id: true, name: true, initials: true } } } },
          comments: {
            orderBy: { createdAt: "asc" },
            include: { mentions: { include: { person: { select: { id: true, name: true, initials: true } } } } },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.person.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, initials: true } }),
    ]);
    issues = issuesResult;
    people = peopleResult;
  } catch {
    // DB may be missing OpenIssueAssignee or IssueCommentMention — load with minimal includes
    try {
      const [issuesResult, peopleResult] = await Promise.all([
        prisma.openIssue.findMany({
          include: {
            workstream: { select: { id: true, name: true, slug: true } },
            subTask: {
              select: {
                id: true,
                name: true,
                initiative: { select: { id: true, name: true } },
              },
            },
            comments: {
              orderBy: { createdAt: "asc" },
              select: { id: true, parentId: true, body: true, authorName: true, createdAt: true },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.person.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, initials: true } }),
      ]);
      people = peopleResult;
      issues = issuesResult.map((issue) => ({
        ...issue,
        assignees: [],
        comments: (issue.comments as { id: string; parentId: string | null; body: string; authorName: string | null; createdAt: Date }[]).map((c) => ({
          ...c,
          mentions: [],
        })),
      }));
    } catch {
      // Bare minimum: no comments at all
      const [issuesResult, peopleResult] = await Promise.all([
        prisma.openIssue.findMany({
          include: {
            workstream: { select: { id: true, name: true, slug: true } },
            subTask: {
              select: {
                id: true,
                name: true,
                initiative: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.person.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, initials: true } }),
      ]);
      people = peopleResult;
      issues = issuesResult.map((issue) => ({ ...issue, assignees: [], comments: [] }));
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Open Issues</h1>
          <p className="text-muted-foreground mt-1">
            Track issues that block or slow down workstream sub-tasks. Use @Name or @Initials in comments to notify people. Syncs with the Notion Open Issues database.
          </p>
        </div>
      </div>
      <OpenIssuesPageClient
        workstreams={serializeForClient(workstreams)}
        issues={serializeForClient(issues)}
        people={serializeForClient(people)}
        currentPersonId={currentPersonId}
      />
    </div>
  );
}


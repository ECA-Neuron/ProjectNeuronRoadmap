import { prisma } from "@/lib/prisma";
import { serializeForClient } from "@/lib/serialize";
import { requireRole } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { AdminView } from "./admin-view";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  try {
    await requireRole(["ADMIN"]);
  } catch {
    redirect("/dashboard");
  }

  const [users, people, needsRefinement] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.person.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, initials: true, userId: true },
    }),
    prisma.initiative.findMany({
      where: { needsRefinement: true, archivedAt: null },
      include: { workstream: true },
      orderBy: { name: "asc" },
    }),
  ]);

  type SerializedUser = { id: string; email: string; name: string | null; role: string; createdAt: string };
  return (
    <AdminView
      users={serializeForClient(users) as unknown as SerializedUser[]}
      people={serializeForClient(people)}
      refinementInitiatives={serializeForClient(needsRefinement)}
    />
  );
}

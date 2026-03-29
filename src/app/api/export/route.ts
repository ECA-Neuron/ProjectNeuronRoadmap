import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const entity = searchParams.get("entity");

  if (!entity) {
    return NextResponse.json({ error: "Missing entity param" }, { status: 400 });
  }

  let csv = "";

  if (entity === "initiatives") {
    const items = await prisma.initiative.findMany({
      where: { archivedAt: null },
      include: { workstream: true },
      orderBy: [{ workstreamId: "asc" }, { sortOrder: "asc" }],
    });
    csv = "Name,Workstream,Category,Status,Start,End,Owner,NeedsRefinement\n";
    csv += items
      .map((i) =>
        [
          `"${i.name}"`,
          `"${i.workstream.name}"`,
          i.category,
          i.status,
          i.plannedStartMonth || "",
          i.plannedEndMonth || "",
          i.ownerInitials || "",
          i.needsRefinement ? "Yes" : "No",
        ].join(",")
      )
      .join("\n");
  } else if (entity === "milestones") {
    const items = await prisma.milestone.findMany({
      include: { initiative: true },
      orderBy: { date: "asc" },
    });
    csv = "Name,Date,DateEnd,Initiative,Notes\n";
    csv += items
      .map((m) =>
        [
          `"${m.name}"`,
          m.date || "",
          m.dateEnd || "",
          `"${m.initiative?.name || "Program-level"}"`,
          `"${(m.notes || "").replace(/"/g, '""')}"`,
        ].join(",")
      )
      .join("\n");
  } else if (entity === "partners") {
    const items = await prisma.partner.findMany({ orderBy: { name: "asc" } });
    csv = "Name,RoleDescription,Agreements\n";
    csv += items
      .map((p) =>
        [
          `"${p.name}"`,
          `"${(p.roleDescription || "").replace(/"/g, '""')}"`,
          `"${(p.agreements || "").replace(/"/g, '""')}"`,
        ].join(",")
      )
      .join("\n");
  } else if (entity === "assignments") {
    const items = await prisma.assignment.findMany({
      include: { person: true, initiative: true },
      orderBy: { month: "asc" },
    });
    csv = "Person,Initiative,Month,HoursPlanned,HoursActual,Notes\n";
    csv += items
      .map((a) =>
        [
          `"${a.person?.name || ""}"`,
          `"${a.initiative.name}"`,
          a.month,
          a.hoursPlanned,
          a.hoursActual,
          `"${(a.notes || "").replace(/"/g, '""')}"`,
        ].join(",")
      )
      .join("\n");
  } else if (entity === "subtasks") {
    const items = await prisma.subTask.findMany({
      include: { initiative: { select: { name: true } } },
      orderBy: { sortOrder: "asc" },
    });
    csv = "ID,Name,Initiative,Points,Status,CompletionPercent,EstimatedDays,Unknowns,Integration,IsAddedScope\n";
    csv += items.map(s => [
      s.id,
      `"${s.name.replace(/"/g, '""')}"`,
      `"${s.initiative.name.replace(/"/g, '""')}"`,
      s.points,
      s.status,
      s.completionPercent,
      s.estimatedDays ?? "",
      s.unknowns || "",
      s.integration || "",
      s.isAddedScope ? "Yes" : "No",
    ].join(",")).join("\n");
  } else if (entity === "snapshots") {
    const items = await prisma.burnSnapshot.findMany({
      include: { program: { select: { name: true } } },
      orderBy: [{ programId: "asc" }, { date: "asc" }],
    });
    csv = "ID,Initiative,Date,TotalPoints,CompletedPoints,PercentComplete\n";
    csv += items.map(s => [
      s.id,
      `"${s.program.name.replace(/"/g, '""')}"`,
      s.date,
      s.totalPoints,
      s.completedPoints,
      s.percentComplete.toFixed(1),
    ].join(",")).join("\n");
  } else if (entity === "users") {
    const items = await prisma.user.findMany({ orderBy: { email: "asc" } });
    csv = "ID,Email,Name,Role\n";
    csv += items.map(u => [
      u.id,
      u.email,
      `"${(u.name || "").replace(/"/g, '""')}"`,
      u.role,
    ].join(",")).join("\n");
  } else if (entity === "open-issues") {
    const items = await prisma.openIssue.findMany({
      include: { workstream: true, subTask: true, comments: true },
      orderBy: { createdAt: "desc" },
    });
    csv = "ID,Title,Severity,Workstream,SubTask,Description,CreatedAt,ResolvedAt,CommentCount\n";
    csv += items.map(i => [
      i.id,
      `"${i.title.replace(/"/g, '""')}"`,
      i.severity,
      `"${(i.workstream?.name || "Unassigned").replace(/"/g, '""')}"`,
      `"${(i.subTask?.name || "").replace(/"/g, '""')}"`,
      `"${(i.description || "").replace(/"/g, '""')}"`,
      i.createdAt,
      i.resolvedAt || "",
      i.comments.length,
    ].join(",")).join("\n");
  } else if (entity === "docs") {
    const items = await prisma.documentation.findMany({
      include: { author: { select: { name: true, email: true } } },
      orderBy: { updatedAt: "desc" },
    });
    csv = "ID,Title,EntityType,Author,Body,CreatedAt,UpdatedAt\n";
    csv += items.map(d => [
      d.id,
      `"${d.title.replace(/"/g, '""')}"`,
      d.entityType,
      `"${(d.author?.name || d.author?.email || "").replace(/"/g, '""')}"`,
      `"${d.body.replace(/"/g, '""').slice(0, 500)}"`,
      d.createdAt,
      d.updatedAt,
    ].join(",")).join("\n");
  } else if (entity === "workstreams") {
    const items = await prisma.workstream.findMany({
      include: { program: { select: { name: true } } },
      orderBy: { sortOrder: "asc" },
    });
    csv = "ID,Name,Slug,Program,Status,TargetDate,Color\n";
    csv += items.map(w => [
      w.id,
      `"${w.name.replace(/"/g, '""')}"`,
      w.slug,
      `"${w.program.name.replace(/"/g, '""')}"`,
      w.status,
      w.targetCompletionDate || "",
      w.color || "",
    ].join(",")).join("\n");
  } else if (entity === "programs") {
    const items = await prisma.program.findMany({ orderBy: { createdAt: "asc" } });
    csv = "ID,Name,Status,Mission,StartDate,TargetDate\n";
    csv += items.map(p => [
      p.id,
      `"${p.name.replace(/"/g, '""')}"`,
      p.status,
      `"${(p.mission || "").replace(/"/g, '""').slice(0, 200)}"`,
      p.startDate || "",
      p.targetDate || "",
    ].join(",")).join("\n");
  } else {
    return NextResponse.json({ error: "Unknown entity" }, { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=${entity}-${Date.now()}.csv`,
    },
  });
}

"use client";

import { useState } from "react";

interface Task {
  id: string;
  name: string;
  status: string;
  points: number;
  completionPercent: number;
  startDate: string | null;
  endDate: string | null;
  initiative: {
    id: string;
    name: string;
    workstream: { id: string; name: string } | null;
    deliverable: { id: string; name: string } | null;
  } | null;
}

interface Feature {
  id: string;
  name: string;
  status: string;
  totalPoints: number;
  startDate: string | null;
  endDate: string | null;
  workstream: { id: string; name: string } | null;
  deliverable: { id: string; name: string } | null;
  subTasks: {
    id: string;
    name: string;
    status: string;
    points: number;
    completionPercent: number;
  }[];
}

interface DashboardIssue {
  id: string;
  title: string;
  severity: string;
  createdAt: string;
  resolvedAt: string | null;
  workstream: { id: string; name: string };
  subTask: { id: string; name: string } | null;
  assignees: { person: { id: string; name: string; initials: string | null } }[];
}

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  BLOCKED: "bg-red-100 text-red-700",
  DONE: "bg-green-100 text-green-700",
};

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

const SEV_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  STOPPING: { label: "Stopping", dot: "bg-red-500", bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-700 dark:text-red-400", border: "border-red-200 dark:border-red-800" },
  SLOWING: { label: "Slowing", dot: "bg-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800" },
  NOT_A_CONCERN: { label: "Low", dot: "bg-green-500", bg: "bg-green-50 dark:bg-green-950/30", text: "text-green-700 dark:text-green-400", border: "border-green-200 dark:border-green-800" },
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{percent}%</span>
    </div>
  );
}

type FilterStatus = "ALL" | "IN_PROGRESS" | "NOT_STARTED" | "BLOCKED" | "DONE";

export function MyDashboardClient({
  userName,
  tasks,
  features,
  openIssues = [],
}: {
  userName: string;
  tasks: Task[];
  features: Feature[];
  openIssues?: DashboardIssue[];
}) {
  const [filter, setFilter] = useState<FilterStatus>("ALL");

  const filteredTasks = filter === "ALL" ? tasks : tasks.filter((t) => t.status === filter);
  const filteredFeatures = filter === "ALL" ? features : features.filter((f) => f.status === filter);

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "DONE").length;
  const inProgressTasks = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const blockedTasks = tasks.filter((t) => t.status === "BLOCKED").length;

  const hasItems = tasks.length > 0 || features.length > 0 || openIssues.length > 0;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Total Tasks" value={totalTasks} />
        <SummaryCard label="In Progress" value={inProgressTasks} color="text-blue-600" />
        <SummaryCard label="Blocked" value={blockedTasks} color="text-red-600" />
        <SummaryCard label="Completed" value={doneTasks} color="text-green-600" />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Filter:</span>
        {(["ALL", "IN_PROGRESS", "NOT_STARTED", "BLOCKED", "DONE"] as FilterStatus[]).map(
          (s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {s === "ALL" ? "All" : STATUS_LABELS[s]}
            </button>
          )
        )}
      </div>

      {!hasItems && (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-lg font-medium text-muted-foreground">No tasks assigned yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Tasks assigned to &ldquo;{userName}&rdquo; in Notion will appear here after syncing.
          </p>
        </div>
      )}

      {/* My Open Issues */}
      {openIssues.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-semibold">My Open Issues</h2>
            <span className="rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 px-2 py-0.5 text-xs font-medium">{openIssues.length}</span>
          </div>
          <div className="grid gap-2">
            {openIssues.map((issue) => {
              const sev = SEV_CONFIG[issue.severity] ?? SEV_CONFIG.NOT_A_CONCERN;
              return (
                <a
                  key={issue.id}
                  href="/open-issues"
                  className={`group flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50 ${sev.border}`}
                >
                  <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${sev.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{issue.title}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${sev.bg} ${sev.text}`}>{sev.label}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <span>{issue.workstream.name}</span>
                      {issue.subTask && <><span>·</span><span>Blocks: {issue.subTask.name}</span></>}
                      <span>·</span>
                      <span>{new Date(issue.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    </div>
                    {issue.assignees.length > 0 && (
                      <div className="flex items-center gap-1 mt-1">
                        {issue.assignees.map((a) => (
                          <span key={a.person.id} className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-[9px] font-bold text-primary" title={a.person.name}>
                            {a.person.initials || a.person.name.slice(0, 2).toUpperCase()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity text-xs mt-1">View →</span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* Features (Initiatives) I own */}
      {filteredFeatures.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Features I Own</h2>
          <div className="space-y-3">
            {filteredFeatures.map((f) => {
              const total = f.subTasks.length;
              const done = f.subTasks.filter((s) => s.status === "DONE").length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <div key={f.id} className="rounded-lg border bg-card p-4 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{f.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {f.workstream?.name}
                        {f.deliverable ? ` → ${f.deliverable.name}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={f.status} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {formatDate(f.startDate)} – {formatDate(f.endDate)}
                    </span>
                    <span>
                      {done}/{total} subtasks done
                    </span>
                  </div>
                  <ProgressBar percent={pct} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* My Tasks */}
      {filteredTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">My Tasks</h2>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-2.5 font-medium">Task</th>
                  <th className="text-left px-4 py-2.5 font-medium">Feature</th>
                  <th className="text-left px-4 py-2.5 font-medium">Workstream</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Dates</th>
                  <th className="text-right px-4 py-2.5 font-medium">Pts</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium max-w-[200px] truncate">
                      {t.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[150px] truncate">
                      {t.initiative?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[130px] truncate">
                      {t.initiative?.workstream?.name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(t.startDate)} – {formatDate(t.endDate)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {t.points > 0 ? t.points : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? ""}`}>{value}</p>
    </div>
  );
}

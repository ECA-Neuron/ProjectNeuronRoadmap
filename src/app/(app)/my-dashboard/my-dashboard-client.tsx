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
}: {
  userName: string;
  tasks: Task[];
  features: Feature[];
}) {
  const [filter, setFilter] = useState<FilterStatus>("ALL");

  const filteredTasks = filter === "ALL" ? tasks : tasks.filter((t) => t.status === filter);
  const filteredFeatures = filter === "ALL" ? features : features.filter((f) => f.status === filter);

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "DONE").length;
  const inProgressTasks = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const blockedTasks = tasks.filter((t) => t.status === "BLOCKED").length;

  const hasItems = tasks.length > 0 || features.length > 0;

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

"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRoadmapItem } from "@/lib/actions/update-roadmap-dates";

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

const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  NOT_STARTED: { label: "Not Started", color: "bg-gray-500/10 text-gray-600 dark:text-gray-400", dot: "bg-gray-400" },
  IN_PROGRESS: { label: "In Progress", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  BLOCKED: { label: "Blocked", color: "bg-red-500/10 text-red-600 dark:text-red-400", dot: "bg-red-500" },
  DONE: { label: "Done", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
};

const SEV_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  STOPPING: { label: "Stopping", dot: "bg-red-500", bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-700 dark:text-red-400", border: "border-red-200 dark:border-red-800" },
  SLOWING: { label: "Slowing", dot: "bg-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-400", border: "border-amber-200 dark:border-amber-800" },
  NOT_A_CONCERN: { label: "Low", dot: "bg-green-500", bg: "bg-green-50 dark:bg-green-950/30", text: "text-green-700 dark:text-green-400", border: "border-green-200 dark:border-green-800" },
};

type KanbanCol = "NOT_STARTED" | "IN_PROGRESS" | "DONE";
type FilterStatus = "ALL" | "IN_PROGRESS" | "NOT_STARTED" | "BLOCKED" | "DONE";
type ViewMode = "list" | "kanban";

function normalizeToKanban(s: string): KanbanCol {
  const u = s.toUpperCase().replace(/\s+/g, "_");
  if (u === "DONE" || u === "COMPLETE" || u === "COMPLETED") return "DONE";
  if (u === "IN_PROGRESS" || u === "BLOCKED") return "IN_PROGRESS";
  return "NOT_STARTED";
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = d.includes("T") ? new Date(d) : new Date(d + "T12:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function isOverdue(d: string | null, status: string): boolean {
  if (!d || status === "DONE") return false;
  const today = new Date().toISOString().slice(0, 10);
  const dateStr = d.includes("T") ? d.slice(0, 10) : d;
  return dateStr < today;
}

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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterStatus>("ALL");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");

  const filteredTasks = useMemo(() => {
    let t = filter === "ALL" ? tasks : tasks.filter(t => t.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      t = t.filter(t => t.name.toLowerCase().includes(q) || t.initiative?.name.toLowerCase().includes(q));
    }
    return t;
  }, [tasks, filter, search]);

  const filteredFeatures = useMemo(() => {
    let f = filter === "ALL" ? features : features.filter(f => f.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter(f => f.name.toLowerCase().includes(q));
    }
    return f;
  }, [features, filter, search]);

  const stats = useMemo(() => ({
    total: tasks.length,
    done: tasks.filter(t => t.status === "DONE").length,
    inProgress: tasks.filter(t => t.status === "IN_PROGRESS").length,
    blocked: tasks.filter(t => t.status === "BLOCKED").length,
    overdue: tasks.filter(t => isOverdue(t.endDate, t.status)).length,
  }), [tasks]);

  const handleStatusChange = useCallback(async (taskId: string, newStatus: string) => {
    startTransition(async () => {
      try {
        await updateRoadmapItem({ id: taskId, level: "Task", status: newStatus });
        router.refresh();
      } catch (err) {
        console.error("Failed to update status:", err);
      }
    });
  }, [router]);

  const kanbanCols = useMemo(() => {
    const groups: Record<KanbanCol, Task[]> = { NOT_STARTED: [], IN_PROGRESS: [], DONE: [] };
    for (const t of filteredTasks) groups[normalizeToKanban(t.status)].push(t);
    return groups;
  }, [filteredTasks]);

  const hasItems = tasks.length > 0 || features.length > 0 || openIssues.length > 0;

  const KANBAN_COLS: { key: KanbanCol; label: string; dot: string }[] = [
    { key: "NOT_STARTED", label: "Not Started", dot: "bg-gray-400" },
    { key: "IN_PROGRESS", label: "In Progress", dot: "bg-blue-500" },
    { key: "DONE", label: "Finished", dot: "bg-emerald-500" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Total Tasks" value={stats.total} icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg>} />
        <StatCard label="In Progress" value={stats.inProgress} accent="text-blue-600 dark:text-blue-400" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" /></svg>} />
        <StatCard label="Blocked" value={stats.blocked} accent="text-red-600 dark:text-red-400" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>} />
        <StatCard label="Completed" value={stats.done} accent="text-emerald-600 dark:text-emerald-400" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>} />
        <StatCard label="Overdue" value={stats.overdue} accent="text-orange-600 dark:text-orange-400" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>} />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex bg-muted/40 rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setViewMode("list")} className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${viewMode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
              List
            </button>
            <button onClick={() => setViewMode("kanban")} className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${viewMode === "kanban" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" /></svg>
              Board
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-1 ml-2">
            {(["ALL", "IN_PROGRESS", "NOT_STARTED", "BLOCKED", "DONE"] as FilterStatus[]).map(s => {
              const info = STATUS_MAP[s] || { label: "All", color: "", dot: "" };
              return (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                    filter === s
                      ? "bg-foreground/[0.06] text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >
                  {s !== "ALL" && <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />}
                  {s === "ALL" ? "All" : info.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-[12px] bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500/40 placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      {!hasItems && (
        <div className="rounded-xl border border-border/60 bg-card p-16 text-center shadow-card">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-muted/50 flex items-center justify-center">
            <svg className="w-6 h-6 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
          </div>
          <p className="text-sm font-medium text-muted-foreground">No tasks assigned yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Tasks assigned to &ldquo;{userName}&rdquo; in Notion will appear here after syncing.
          </p>
        </div>
      )}

      {/* My Open Issues */}
      {openIssues.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold">My Open Issues</h2>
            <span className="text-[10px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-md tabular-nums">{openIssues.length}</span>
          </div>
          <div className="grid gap-2">
            {openIssues.map(issue => {
              const sev = SEV_CONFIG[issue.severity] ?? SEV_CONFIG.NOT_A_CONCERN;
              return (
                <a key={issue.id} href="/open-issues" className={`group flex items-start gap-3 rounded-xl border p-3 transition-all hover:shadow-md hover:border-border/80 ${sev.border}`}>
                  <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${sev.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[13px] truncate">{issue.title}</span>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${sev.bg} ${sev.text}`}>{sev.label}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                      <span>{issue.workstream.name}</span>
                      {issue.subTask && <><span>·</span><span>Blocks: {issue.subTask.name}</span></>}
                    </div>
                  </div>
                  <span className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity text-[11px] mt-1">View →</span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* Features I Own */}
      {filteredFeatures.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3">Features I Own</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {filteredFeatures.map(f => {
              const total = f.subTasks.length;
              const done = f.subTasks.filter(s => s.status === "DONE").length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const sInfo = STATUS_MAP[f.status] ?? STATUS_MAP.NOT_STARTED;
              return (
                <div key={f.id} className="rounded-xl border border-border/60 bg-card p-4 space-y-2.5 shadow-card hover:shadow-card-hover transition-shadow">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[13px] font-semibold truncate leading-tight">{f.name}</h3>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {f.workstream?.name}{f.deliverable ? ` → ${f.deliverable.name}` : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md ${sInfo.color}`}>{sInfo.label}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{fmtDate(f.startDate)} – {fmtDate(f.endDate)}</span>
                    <span className="tabular-nums">{done}/{total} done</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span className="text-[11px] font-semibold tabular-nums text-muted-foreground w-8 text-right">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* My Tasks — List view */}
      {viewMode === "list" && filteredTasks.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3">My Tasks</h2>
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-card">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Task</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Feature</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Due</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Pts</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map(t => {
                  const overdue = isOverdue(t.endDate, t.status);
                  return (
                    <tr key={t.id} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors group">
                      <td className="px-4 py-3 font-medium max-w-[220px]">
                        <span className="truncate block">{t.name}</span>
                        {t.initiative?.workstream?.name && (
                          <span className="text-[10px] text-muted-foreground/60 block mt-0.5">{t.initiative.workstream.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground max-w-[160px] truncate">{t.initiative?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <select
                          value={t.status}
                          onChange={e => handleStatusChange(t.id, e.target.value)}
                          className={`text-[11px] font-semibold rounded-md px-2 py-1 border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/40 ${(STATUS_MAP[t.status] ?? STATUS_MAP.NOT_STARTED).color}`}
                        >
                          <option value="NOT_STARTED">Not Started</option>
                          <option value="IN_PROGRESS">In Progress</option>
                          <option value="BLOCKED">Blocked</option>
                          <option value="DONE">Done</option>
                        </select>
                      </td>
                      <td className={`px-4 py-3 text-[11px] tabular-nums ${overdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                        {fmtDate(t.endDate)}
                        {overdue && <span className="ml-1 text-[9px]">overdue</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{t.points > 0 ? t.points : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* My Tasks — Kanban view */}
      {viewMode === "kanban" && (
        <section>
          <h2 className="text-sm font-semibold mb-3">My Tasks</h2>
          <div className="grid grid-cols-3 gap-4" style={{ minHeight: 300 }}>
            {KANBAN_COLS.map(col => {
              const cards = kanbanCols[col.key];
              return (
                <div key={col.key} className="rounded-xl border border-border/60 bg-card">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    <span className="text-[12px] font-semibold">{col.label}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground tabular-nums bg-muted/50 px-1.5 py-0.5 rounded-md">{cards.length}</span>
                  </div>
                  <div className="p-2 space-y-2 max-h-[500px] overflow-y-auto">
                    {cards.length === 0 && (
                      <div className="flex items-center justify-center py-8 rounded-lg bg-muted/10">
                        <p className="text-[11px] text-muted-foreground/50">Empty</p>
                      </div>
                    )}
                    {cards.map(t => (
                      <div key={t.id} className="group rounded-lg border border-border/40 bg-background p-3 hover:shadow-md hover:border-border/80 transition-all">
                        <p className="text-[12px] font-medium leading-snug mb-1.5 line-clamp-2">{t.name}</p>
                        {t.initiative?.name && (
                          <p className="text-[10px] text-muted-foreground truncate mb-2">{t.initiative.name}</p>
                        )}
                        <div className="flex items-center gap-2">
                          {t.endDate && (
                            <span className={`text-[10px] tabular-nums ${isOverdue(t.endDate, t.status) ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                              {fmtDate(t.endDate)}
                            </span>
                          )}
                          {t.points > 0 && (
                            <span className="text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{t.points} pts</span>
                          )}
                        </div>
                        <div className="mt-2 pt-2 border-t border-border/30 opacity-0 group-hover:opacity-100 transition-opacity">
                          <select
                            value={t.status}
                            onChange={e => handleStatusChange(t.id, e.target.value)}
                            className="w-full h-6 text-[10px] bg-muted/50 border-0 rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40 cursor-pointer"
                          >
                            <option value="NOT_STARTED">Not Started</option>
                            <option value="IN_PROGRESS">In Progress</option>
                            <option value="BLOCKED">Blocked</option>
                            <option value="DONE">Done</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isPending && (
        <div className="fixed bottom-4 right-4 bg-card border border-border/60 rounded-lg px-3 py-2 shadow-elevated text-[11px] text-muted-foreground flex items-center gap-2 z-50 animate-fade-in">
          <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
          Saving...
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent, icon }: { label: string; value: number; accent?: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border/60 p-4 shadow-card hover:shadow-card-hover transition-shadow duration-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-muted-foreground/40">{icon}</span>
      </div>
      <p className={`text-2xl font-bold tracking-tight tabular-nums ${accent || ""}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">{label}</p>
    </div>
  );
}

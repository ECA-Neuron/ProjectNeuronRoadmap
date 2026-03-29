"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRoadmapItem } from "@/lib/actions/update-roadmap-dates";
import { addRoadmapItem } from "@/lib/actions/add-roadmap-item";
import dynamic from "next/dynamic";

const PersonalBurndownChart = dynamic(() => import("./personal-burndown").then(m => m.default), {
  ssr: false,
  loading: () => <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">Loading chart...</div>,
});

// ─── Types ───────────────────────────────────────────

interface Task {
  id: string; name: string; status: string; points: number;
  completionPercent: number; startDate: string | null; endDate: string | null;
  initiative: { id: string; name: string; workstream: { id: string; name: string } | null; deliverable: { id: string; name: string } | null } | null;
}

interface SubTaskInFeature { id: string; name: string; status: string; points: number; completionPercent: number; startDate?: string | null; endDate?: string | null; assignee?: { id: string; name: string; initials: string | null } | null }

interface Feature {
  id: string; name: string; status: string; totalPoints: number;
  startDate: string | null; endDate: string | null;
  workstream: { id: string; name: string } | null;
  deliverable: { id: string; name: string } | null;
  subTasks: SubTaskInFeature[];
}

interface DashboardIssue {
  id: string; title: string; severity: string; createdAt: string; resolvedAt: string | null;
  workstream: { id: string; name: string }; subTask: { id: string; name: string } | null;
  assignees: { person: { id: string; name: string; initials: string | null } }[];
}

interface ProgressLog {
  id: string; taskName: string; logDate: string | null; percentComplete: number | null;
  currentPoints: number | null; totalPoints: number | null;
  updateComment: string | null; completedBy: string | null;
  subTaskId: string | null; initiativeId: string | null;
}

interface WsOption {
  id: string; name: string;
  deliverables: { id: string; name: string; initiatives: { id: string; name: string }[] }[];
  initiatives: { id: string; name: string }[];
}

// ─── Constants ───────────────────────────────────────

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
type ViewMode = "list" | "board";
type SortKey = "status" | "date" | "name" | "points";

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

function getDateVal(d: string | null): number {
  if (!d) return Infinity;
  return new Date(d.includes("T") ? d : d + "T12:00:00Z").getTime();
}

// ─── Unified item for board view ─────────────────────

interface BoardItem {
  id: string; name: string; status: string; type: "task" | "feature";
  endDate: string | null; startDate: string | null; points: number;
  parent: string; workstream: string; pct: number;
}

// ─── Component ───────────────────────────────────────

export function MyDashboardClient({
  userName, tasks, features, openIssues = [], progressLogs = [], workstreams = [],
}: {
  userName: string; tasks: Task[]; features: Feature[];
  openIssues?: DashboardIssue[]; progressLogs?: ProgressLog[]; workstreams?: WsOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<FilterStatus>("ALL");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [showAddTask, setShowAddTask] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Collect all subtasks from features for a unified view
  const allSubTasks = useMemo(() => {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const items: BoardItem[] = [];
    for (const f of features) {
      for (const st of f.subTasks) {
        if (!taskMap.has(st.id)) {
          items.push({
            id: st.id, name: st.name, status: st.status, type: "task",
            endDate: (st as any).endDate ?? null, startDate: (st as any).startDate ?? null,
            points: st.points, parent: f.name, workstream: f.workstream?.name ?? "",
            pct: st.completionPercent,
          });
        }
      }
    }
    for (const t of tasks) {
      items.push({
        id: t.id, name: t.name, status: t.status, type: "task",
        endDate: t.endDate, startDate: t.startDate, points: t.points,
        parent: t.initiative?.name ?? "", workstream: t.initiative?.workstream?.name ?? "",
        pct: t.completionPercent,
      });
    }
    return items;
  }, [tasks, features]);

  const sortedItems = useMemo(() => {
    let items = [...allSubTasks];
    if (filter !== "ALL") items = items.filter(i => i.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q) || i.parent.toLowerCase().includes(q) || i.workstream.toLowerCase().includes(q));
    }
    const statusOrder: Record<string, number> = { BLOCKED: 0, IN_PROGRESS: 1, NOT_STARTED: 2, DONE: 3 };
    switch (sortKey) {
      case "date": items.sort((a, b) => getDateVal(a.endDate) - getDateVal(b.endDate)); break;
      case "name": items.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "points": items.sort((a, b) => (b.points || 0) - (a.points || 0)); break;
      default: items.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));
    }
    return items;
  }, [allSubTasks, filter, search, sortKey]);

  const stats = useMemo(() => {
    const all = allSubTasks;
    return {
      total: all.length,
      done: all.filter(t => t.status === "DONE").length,
      inProgress: all.filter(t => t.status === "IN_PROGRESS").length,
      blocked: all.filter(t => t.status === "BLOCKED").length,
      overdue: all.filter(t => isOverdue(t.endDate, t.status)).length,
      totalPoints: all.reduce((s, t) => s + (t.points || 0), 0),
      donePoints: all.filter(t => t.status === "DONE").reduce((s, t) => s + (t.points || 0), 0),
    };
  }, [allSubTasks]);

  const weekOverWeek = useMemo(() => {
    if (!progressLogs || progressLogs.length === 0) return [];
    const weeks: Record<string, { pts: number; count: number; weekLabel: string }> = {};
    for (const log of progressLogs) {
      if (!log.logDate) continue;
      const d = new Date(log.logDate);
      const weekStart = new Date(d);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      if (!weeks[key]) {
        weeks[key] = { pts: 0, count: 0, weekLabel: weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
      }
      weeks[key].pts += log.currentPoints ?? 0;
      weeks[key].count += 1;
    }
    return Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([, v]) => v);
  }, [progressLogs]);

  const kanbanCols = useMemo(() => {
    const groups: Record<KanbanCol, BoardItem[]> = { NOT_STARTED: [], IN_PROGRESS: [], DONE: [] };
    for (const item of sortedItems) groups[normalizeToKanban(item.status)].push(item);
    return groups;
  }, [sortedItems]);

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

  const handleSync = useCallback(async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch("/api/sync/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction: "push" }) });
      const data = await res.json();
      if (!res.ok) { setSyncMsg(`Error: ${data.error ?? "Failed"}`); } else { setSyncMsg(`Pushed ${data.synced} items`); router.refresh(); }
    } catch { setSyncMsg("Network error"); }
    finally { setSyncing(false); setTimeout(() => setSyncMsg(null), 4000); }
  }, [router]);

  const hasItems = allSubTasks.length > 0 || openIssues.length > 0;
  const overallPct = stats.totalPoints > 0 ? Math.round((stats.donePoints / stats.totalPoints) * 100) : (stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0);

  const KANBAN_COLS: { key: KanbanCol; label: string; dot: string }[] = [
    { key: "NOT_STARTED", label: "Not Started", dot: "bg-gray-400" },
    { key: "IN_PROGRESS", label: "In Progress", dot: "bg-blue-500" },
    { key: "DONE", label: "Finished", dot: "bg-emerald-500" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Stats + Progress ── */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatCard label="Total Tasks" value={stats.total} />
        <StatCard label="In Progress" value={stats.inProgress} accent="text-blue-600 dark:text-blue-400" />
        <StatCard label="Blocked" value={stats.blocked} accent="text-red-600 dark:text-red-400" />
        <StatCard label="Completed" value={stats.done} accent="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="Overdue" value={stats.overdue} accent="text-orange-600 dark:text-orange-400" />
        <div className="bg-card rounded-xl border border-border/60 p-4 shadow-card">
          <p className="text-[11px] text-muted-foreground font-medium mb-1">Overall</p>
          <p className="text-2xl font-bold tracking-tight tabular-nums">{overallPct}%</p>
          <div className="h-1.5 mt-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500" style={{ width: `${overallPct}%` }} />
          </div>
        </div>
      </div>

      {/* ── Personal Burndown + Week-over-Week ── */}
      {(progressLogs.length > 0 || weekOverWeek.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Burndown */}
          <div className="bg-card rounded-xl border border-border/60 p-5 shadow-card">
            <h3 className="text-[13px] font-semibold mb-3">My Burndown</h3>
            <PersonalBurndownChart
              totalPoints={stats.totalPoints}
              progressLogs={progressLogs}
            />
          </div>
          {/* Week-over-Week */}
          <div className="bg-card rounded-xl border border-border/60 p-5 shadow-card">
            <h3 className="text-[13px] font-semibold mb-3">Week-over-Week Progress</h3>
            {weekOverWeek.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">No weekly data yet</p>
            ) : (
              <div className="space-y-2">
                {weekOverWeek.map((w, i) => {
                  const maxPts = Math.max(...weekOverWeek.map(wk => wk.pts), 1);
                  const pct = Math.round((w.pts / maxPts) * 100);
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground w-14 shrink-0 tabular-nums">{w.weekLabel}</span>
                      <div className="flex-1 h-5 bg-muted/30 rounded-md overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-violet-500/80 to-blue-500/80 rounded-md transition-all duration-300 flex items-center pl-2" style={{ width: `${Math.max(pct, 8)}%` }}>
                          {w.pts > 0 && <span className="text-[9px] font-bold text-white">{w.pts} pts</span>}
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">{w.count} upd</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Controls Bar ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex bg-muted/40 rounded-lg p-0.5 gap-0.5">
            <button onClick={() => setViewMode("list")} className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-all ${viewMode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
              List
            </button>
            <button onClick={() => setViewMode("board")} className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-all ${viewMode === "board" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" /></svg>
              Board
            </button>
          </div>

          {/* Sort */}
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="h-8 text-[11px] bg-background border border-border/60 rounded-lg px-2 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
          >
            <option value="status">Sort: Status</option>
            <option value="date">Sort: Due Date</option>
            <option value="name">Sort: Name</option>
            <option value="points">Sort: Points</option>
          </select>

          {/* Filters */}
          <div className="flex items-center gap-1">
            {(["ALL", "IN_PROGRESS", "NOT_STARTED", "BLOCKED", "DONE"] as FilterStatus[]).map(s => {
              const info = STATUS_MAP[s] || { label: "All", color: "", dot: "" };
              return (
                <button key={s} onClick={() => setFilter(s)} className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md transition-all ${filter === s ? "bg-foreground/[0.06] text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}>
                  {s !== "ALL" && <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />}
                  {s === "ALL" ? "All" : info.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="w-40 h-8 pl-8 pr-3 text-[11px] bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500/40 placeholder:text-muted-foreground/50" />
          </div>
          {syncMsg && <span className={`text-[10px] px-2 py-1 rounded-md font-medium ${syncMsg.startsWith("Error") ? "bg-red-500/10 text-red-600" : "bg-emerald-500/10 text-emerald-600"}`}>{syncMsg}</span>}
          <button onClick={handleSync} disabled={syncing} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border border-border/60 bg-card hover:bg-accent transition-colors disabled:opacity-50">
            {syncing ? <Spinner /> : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>}
            Push Updates
          </button>
          <button onClick={() => setShowAddTask(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Add Task
          </button>
        </div>
      </div>

      {!hasItems && (
        <div className="rounded-xl border border-border/60 bg-card p-16 text-center shadow-card">
          <p className="text-sm font-medium text-muted-foreground">No tasks assigned yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Tasks assigned to &ldquo;{userName}&rdquo; in Notion will appear here after syncing.</p>
        </div>
      )}

      {/* ── Open Issues ── */}
      {openIssues.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold">My Open Issues</h2>
            <span className="text-[10px] font-semibold bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-md tabular-nums">{openIssues.length}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {openIssues.map(issue => {
              const sev = SEV_CONFIG[issue.severity] ?? SEV_CONFIG.NOT_A_CONCERN;
              return (
                <a key={issue.id} href="/open-issues" className={`group flex items-start gap-3 rounded-xl border p-3 transition-all hover:shadow-md hover:border-border/80 ${sev.border}`}>
                  <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${sev.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[12px] truncate">{issue.title}</span>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${sev.bg} ${sev.text}`}>{sev.label}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                      <span>{issue.workstream.name}</span>
                      {issue.subTask && <><span>·</span><span>Blocks: {issue.subTask.name}</span></>}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Features I Own (List mode only) ── */}
      {viewMode === "list" && features.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3">Features I Own</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {features.map(f => {
              const total = f.subTasks.length;
              const done = f.subTasks.filter(s => s.status === "DONE").length;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const sInfo = STATUS_MAP[f.status] ?? STATUS_MAP.NOT_STARTED;
              return (
                <div key={f.id} className="rounded-xl border border-border/60 bg-card p-4 space-y-2.5 shadow-card hover:shadow-card-hover transition-shadow">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-[13px] font-semibold truncate leading-tight">{f.name}</h3>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{f.workstream?.name}{f.deliverable ? ` → ${f.deliverable.name}` : ""}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md ${sInfo.color}`}>{sInfo.label}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{fmtDate(f.startDate)} – {fmtDate(f.endDate)}</span>
                    <span className="tabular-nums">{done}/{total} done</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-8 text-right">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── All Tasks — List view ── */}
      {viewMode === "list" && sortedItems.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3">All My Tasks <span className="text-muted-foreground font-normal">({sortedItems.length})</span></h2>
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
                {sortedItems.map(t => {
                  const overdue = isOverdue(t.endDate, t.status);
                  return (
                    <tr key={t.id} className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-2.5 font-medium max-w-[220px]">
                        <span className="truncate block text-[12px]">{t.name}</span>
                        {t.workstream && <span className="text-[9px] text-muted-foreground/50 block">{t.workstream}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-[150px] truncate text-[11px]">{t.parent || "—"}</td>
                      <td className="px-4 py-2.5">
                        <select value={t.status} onChange={e => handleStatusChange(t.id, e.target.value)} className={`text-[10px] font-semibold rounded-md px-2 py-1 border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/40 ${(STATUS_MAP[t.status] ?? STATUS_MAP.NOT_STARTED).color}`}>
                          <option value="NOT_STARTED">Not Started</option>
                          <option value="IN_PROGRESS">In Progress</option>
                          <option value="BLOCKED">Blocked</option>
                          <option value="DONE">Done</option>
                        </select>
                      </td>
                      <td className={`px-4 py-2.5 text-[10px] tabular-nums ${overdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                        {fmtDate(t.endDate)}{overdue && <span className="ml-1 text-[8px]">overdue</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground text-[11px]">{t.points > 0 ? t.points : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── All Tasks — Board view ── */}
      {viewMode === "board" && (
        <section>
          <h2 className="text-sm font-semibold mb-3">All My Tasks <span className="text-muted-foreground font-normal">({sortedItems.length})</span></h2>
          <div className="grid grid-cols-3 gap-4" style={{ minHeight: 300 }}>
            {KANBAN_COLS.map(col => {
              const cards = kanbanCols[col.key];
              return (
                <div key={col.key} className="rounded-xl border border-border/60 bg-card">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    <span className="text-[12px] font-semibold">{col.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums bg-muted/50 px-1.5 py-0.5 rounded-md">{cards.length}</span>
                  </div>
                  <div className="p-2 space-y-2 max-h-[560px] overflow-y-auto">
                    {cards.length === 0 && (
                      <div className="flex items-center justify-center py-10 rounded-lg bg-muted/5">
                        <p className="text-[10px] text-muted-foreground/40">No tasks</p>
                      </div>
                    )}
                    {cards.map(t => (
                      <div key={t.id} className="group rounded-lg border border-border/40 bg-background p-3 hover:shadow-md hover:border-border/80 transition-all">
                        <p className="text-[12px] font-medium leading-snug mb-1 line-clamp-2">{t.name}</p>
                        {t.parent && <p className="text-[9px] text-muted-foreground truncate mb-1.5">{t.workstream ? `${t.workstream} → ` : ""}{t.parent}</p>}
                        <div className="flex items-center gap-2 flex-wrap">
                          {t.endDate && (
                            <span className={`text-[9px] tabular-nums ${isOverdue(t.endDate, t.status) ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>{fmtDate(t.endDate)}</span>
                          )}
                          {t.points > 0 && <span className="text-[9px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded">{t.points} pts</span>}
                        </div>
                        <div className="mt-2 pt-1.5 border-t border-border/20 opacity-0 group-hover:opacity-100 transition-opacity">
                          <select value={t.status} onChange={e => handleStatusChange(t.id, e.target.value)} className="w-full h-6 text-[10px] bg-muted/50 border-0 rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40 cursor-pointer">
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

      {/* ── Add Task Modal ── */}
      {showAddTask && (
        <AddTaskModal
          workstreams={workstreams}
          onClose={() => setShowAddTask(false)}
          onSaved={() => { setShowAddTask(false); router.refresh(); }}
        />
      )}

      {isPending && (
        <div className="fixed bottom-4 right-4 bg-card border border-border/60 rounded-lg px-3 py-2 shadow-elevated text-[11px] text-muted-foreground flex items-center gap-2 z-50 animate-fade-in">
          <Spinner /> Saving...
        </div>
      )}
    </div>
  );
}

// ─── Add Task Modal ──────────────────────────────────

function AddTaskModal({ workstreams, onClose, onSaved }: { workstreams: WsOption[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [status, setStatus] = useState("NOT_STARTED");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  const featureOptions = useMemo(() => {
    const opts: { id: string; label: string }[] = [];
    for (const ws of workstreams) {
      for (const d of ws.deliverables) {
        for (const i of d.initiatives) opts.push({ id: i.id, label: `${ws.name} → ${d.name} → ${i.name}` });
      }
      for (const i of ws.initiatives) opts.push({ id: i.id, label: `${ws.name} → ${i.name}` });
    }
    return opts;
  }, [workstreams]);

  const handleCreate = async () => {
    if (!name.trim() || !featureId || saving) return;
    setSaving(true);
    try {
      await addRoadmapItem({ level: "Task", name: name.trim(), parentId: featureId, status, startDate: startDate || null, endDate: endDate || null });
      onSaved();
    } catch (err) {
      console.error("Failed to create task:", err);
      setSaving(false);
    }
  };

  const fieldCls = "w-full h-8 text-[12px] bg-background border border-border/60 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-elevated border border-border/60 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Add New Task</h3>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs">✕</button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Task Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="What needs to be done?" className={fieldCls} autoFocus />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Feature *</label>
            <select value={featureId} onChange={e => setFeatureId(e.target.value)} className={fieldCls}>
              <option value="">Select a feature...</option>
              {featureOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={fieldCls}>
                <option value="NOT_STARTED">Not Started</option>
                <option value="IN_PROGRESS">In Progress</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Start</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={fieldCls} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">End</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={fieldCls} />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button onClick={handleCreate} disabled={!name.trim() || !featureId || saving} className="flex-1 h-9 text-[12px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
              {saving ? "Creating..." : "Create Task"}
            </button>
            <button onClick={onClose} disabled={saving} className="h-9 px-4 text-[12px] text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-card rounded-xl border border-border/60 p-4 shadow-card hover:shadow-card-hover transition-shadow duration-200">
      <p className={`text-2xl font-bold tracking-tight tabular-nums ${accent || ""}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">{label}</p>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRoadmapItem } from "@/lib/actions/update-roadmap-dates";
import { addRoadmapItem } from "@/lib/actions/add-roadmap-item";
import { logProgressUpdate } from "@/lib/actions/log-progress-update";
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
  workstream: { id: string; name: string } | null; subTask: { id: string; name: string } | null;
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
  parent: string; workstream: string; deliverable: string; pct: number;
  featureId: string | null;
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
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [showAddTask, setShowAddTask] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [wsFilter, setWsFilter] = useState("ALL");
  const [featureFilter, setFeatureFilter] = useState("ALL");

  const allSubTasks = useMemo(() => {
    const seen = new Set<string>();
    const items: BoardItem[] = [];
    for (const t of tasks) {
      seen.add(t.id);
      items.push({
        id: t.id, name: t.name, status: t.status, type: "task",
        endDate: t.endDate, startDate: t.startDate, points: t.points,
        parent: t.initiative?.name ?? "", workstream: t.initiative?.workstream?.name ?? "",
        deliverable: t.initiative?.deliverable?.name ?? "", pct: t.completionPercent,
        featureId: t.initiative?.id ?? null,
      });
    }
    for (const f of features) {
      for (const st of f.subTasks) {
        if (!seen.has(st.id)) {
          seen.add(st.id);
          items.push({
            id: st.id, name: st.name, status: st.status, type: "task",
            endDate: (st as any).endDate ?? null, startDate: (st as any).startDate ?? null,
            points: st.points, parent: f.name, workstream: f.workstream?.name ?? "",
            deliverable: f.deliverable?.name ?? "", pct: st.completionPercent,
            featureId: f.id,
          });
        }
      }
    }
    return items;
  }, [tasks, features]);

  const wsNames = useMemo(() => [...new Set(allSubTasks.map(i => i.workstream).filter(Boolean))].sort(), [allSubTasks]);
  const featureNames = useMemo(() => {
    let items = allSubTasks;
    if (wsFilter !== "ALL") items = items.filter(i => i.workstream === wsFilter);
    return [...new Set(items.map(i => i.parent).filter(Boolean))].sort();
  }, [allSubTasks, wsFilter]);

  const sortedItems = useMemo(() => {
    let items = [...allSubTasks];
    if (filter !== "ALL") items = items.filter(i => i.status === filter);
    if (wsFilter !== "ALL") items = items.filter(i => i.workstream === wsFilter);
    if (featureFilter !== "ALL") items = items.filter(i => i.parent === featureFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(i => i.name.toLowerCase().includes(q) || i.parent.toLowerCase().includes(q) || i.workstream.toLowerCase().includes(q));
    }
    const statusOrder: Record<string, number> = { BLOCKED: 0, IN_PROGRESS: 1, NOT_STARTED: 2, DONE: 3 };
    switch (sortKey) {
      case "date": items.sort((a, b) => {
        const aVal = a.endDate ? new Date(a.endDate).getTime() : -Infinity;
        const bVal = b.endDate ? new Date(b.endDate).getTime() : -Infinity;
        return bVal - aVal; // most recent first
      }); break;
      case "name": items.sort((a, b) => a.name.localeCompare(b.name)); break;
      case "points": items.sort((a, b) => (b.points || 0) - (a.points || 0)); break;
      default: items.sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));
    }
    return items;
  }, [allSubTasks, filter, search, sortKey, wsFilter, featureFilter]);

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

  const weekOverWeekData = useMemo(() => {
    if (!progressLogs || progressLogs.length === 0) return { weeks: [] as { pts: number; count: number; weekLabel: string; delta: number }[], avg: 0 };
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
    const sorted = Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([, v]) => v);
    const avg = sorted.length > 0 ? sorted.reduce((s, w) => s + w.pts, 0) / sorted.length : 0;
    const withDelta = sorted.map(w => ({ ...w, delta: w.pts - avg }));
    return { weeks: withDelta, avg };
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

  const handlePctChange = useCallback(async (taskId: string, pct: number, comment: string, totalPts: number): Promise<string | null> => {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const currentPoints = Math.round((totalPts * clamped) / 100);
    try {
      await logProgressUpdate({
        subTaskId: taskId,
        currentPoints,
        totalPoints: totalPts,
        percentComplete: clamped,
        comment,
      });
      const autoStatus = clamped >= 100 ? "DONE" : clamped > 0 ? "IN_PROGRESS" : undefined;
      if (autoStatus) {
        await updateRoadmapItem({ id: taskId, level: "Task", status: autoStatus });
      }
      startTransition(() => { router.refresh(); });
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to log progress:", msg);
      return msg;
    }
  }, [router, startTransition]);

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
      {allSubTasks.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Burndown */}
          <div className="bg-card rounded-xl border border-border/60 p-5 shadow-card">
            <h3 className="text-[13px] font-semibold mb-3">My Burndown</h3>
            <PersonalBurndownChart
              totalPoints={stats.totalPoints}
              tasks={allSubTasks.map(t => ({ id: t.id, points: t.points, completionPercent: t.pct, endDate: t.endDate }))}
              progressLogs={progressLogs}
            />
          </div>
          {/* Week-over-Week */}
          <div className="bg-card rounded-xl border border-border/60 p-5 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-semibold">Week-over-Week Progress</h3>
              {weekOverWeekData.avg > 0 && (
                <span className="text-[10px] font-medium text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-md tabular-nums">
                  Avg: {weekOverWeekData.avg.toFixed(1)} pts/wk
                </span>
              )}
            </div>
            {weekOverWeekData.weeks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">No weekly data yet</p>
            ) : (
              <div className="space-y-2">
                {weekOverWeekData.weeks.map((w, i) => {
                  const maxPts = Math.max(...weekOverWeekData.weeks.map(wk => wk.pts), 1);
                  const pct = Math.round((w.pts / maxPts) * 100);
                  const overUnder = w.delta;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground w-14 shrink-0 tabular-nums">{w.weekLabel}</span>
                      <div className="flex-1 h-5 bg-muted/30 rounded-md overflow-hidden relative">
                        <div className="h-full bg-gradient-to-r from-violet-500/80 to-blue-500/80 rounded-md transition-all duration-300 flex items-center pl-2" style={{ width: `${Math.max(pct, 8)}%` }}>
                          {w.pts > 0 && <span className="text-[9px] font-bold text-white">{w.pts} pts</span>}
                        </div>
                      </div>
                      <span className={`text-[9px] font-semibold tabular-nums w-14 text-right ${overUnder > 0.5 ? "text-emerald-500" : overUnder < -0.5 ? "text-red-400" : "text-muted-foreground"}`}>
                        {overUnder > 0.5 ? `+${overUnder.toFixed(1)}` : overUnder < -0.5 ? overUnder.toFixed(1) : "avg"}
                      </span>
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

          {/* Workstream filter */}
          <select
            value={wsFilter}
            onChange={e => { setWsFilter(e.target.value); setFeatureFilter("ALL"); }}
            className="h-8 text-[11px] bg-background border border-border/60 rounded-lg px-2 focus:outline-none focus:ring-1 focus:ring-blue-500/40 max-w-[160px] truncate"
          >
            <option value="ALL">All Workstreams</option>
            {wsNames.map(ws => <option key={ws} value={ws}>{ws}</option>)}
          </select>

          {/* Feature filter */}
          <select
            value={featureFilter}
            onChange={e => setFeatureFilter(e.target.value)}
            className="h-8 text-[11px] bg-background border border-border/60 rounded-lg px-2 focus:outline-none focus:ring-1 focus:ring-blue-500/40 max-w-[160px] truncate"
          >
            <option value="ALL">All Features</option>
            {featureNames.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          {/* Status Filters */}
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
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-24">Progress</th>
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
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-300 ${t.pct >= 100 ? "bg-emerald-500" : t.pct > 50 ? "bg-blue-500" : t.pct > 0 ? "bg-amber-500" : "bg-gray-400"}`} style={{ width: `${Math.min(t.pct, 100)}%` }} />
                          </div>
                          <span className="text-[9px] font-semibold tabular-nums text-muted-foreground w-7 text-right">{t.pct}%</span>
                        </div>
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

      {/* ── All Tasks — Board view (drag-and-drop) ── */}
      {viewMode === "board" && (
        <section>
          <h2 className="text-sm font-semibold mb-3">All My Tasks <span className="text-muted-foreground font-normal">({sortedItems.length})</span></h2>
          <div className="grid grid-cols-3 gap-4" style={{ minHeight: 300 }}>
            {KANBAN_COLS.map(col => {
              const cards = kanbanCols[col.key];
              const targetStatus = col.key === "DONE" ? "DONE" : col.key === "IN_PROGRESS" ? "IN_PROGRESS" : "NOT_STARTED";
              return (
                <div
                  key={col.key}
                  className="rounded-xl border border-border/60 bg-card transition-colors"
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("ring-2", "ring-blue-500/40"); }}
                  onDragLeave={e => { e.currentTarget.classList.remove("ring-2", "ring-blue-500/40"); }}
                  onDrop={e => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("ring-2", "ring-blue-500/40");
                    const taskId = e.dataTransfer.getData("text/plain");
                    if (taskId) handleStatusChange(taskId, targetStatus);
                  }}
                >
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    <span className="text-[12px] font-semibold">{col.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground tabular-nums bg-muted/50 px-1.5 py-0.5 rounded-md">{cards.length}</span>
                  </div>
                  <div className="p-2 space-y-2 max-h-[560px] overflow-y-auto">
                    {cards.length === 0 && (
                      <div className="flex items-center justify-center py-10 rounded-lg border-2 border-dashed border-border/30">
                        <p className="text-[10px] text-muted-foreground/40">Drop tasks here</p>
                      </div>
                    )}
                    {cards.map(t => (
                      <KanbanCard key={t.id} item={t} onStatusChange={handleStatusChange} onPctChange={handlePctChange} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Open Issues (below tasks) ── */}
      {openIssues.length > 0 && (
        <section>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-4 mb-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
            <div>
              <p className="text-[13px] font-semibold text-amber-600 dark:text-amber-400">Need to Address: {openIssues.length} Open Issue{openIssues.length !== 1 ? "s" : ""}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">These open issues are assigned to you or mention you and need your attention.</p>
            </div>
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
                      <span>{issue.workstream?.name ?? "Unassigned"}</span>
                      {issue.subTask && <><span>·</span><span>Blocks: {issue.subTask.name}</span></>}
                    </div>
                  </div>
                </a>
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

// ─── Kanban Card (draggable, with progress log) ─────

function KanbanCard({ item, onStatusChange, onPctChange }: {
  item: BoardItem;
  onStatusChange: (id: string, status: string) => void;
  onPctChange: (id: string, pct: number, comment: string, totalPts: number) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [localPct, setLocalPct] = useState(item.pct);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overdue = isOverdue(item.endDate, item.status);

  const pctColor = item.pct >= 100
    ? "from-emerald-500 to-emerald-400"
    : item.pct > 50
      ? "from-blue-500 to-cyan-400"
      : item.pct > 0
        ? "from-amber-500 to-orange-400"
        : "from-gray-400 to-gray-300";

  const canSave = comment.trim().length > 0 && localPct !== item.pct;

  return (
    <div
      draggable={!editing}
      onDragStart={e => {
        if (editing) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", item.id);
        e.dataTransfer.effectAllowed = "move";
        (e.currentTarget as HTMLElement).style.opacity = "0.5";
      }}
      onDragEnd={e => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
      className={`group rounded-lg border bg-background p-3 transition-all ${editing ? "border-blue-500/50 shadow-md ring-1 ring-blue-500/20" : "border-border/40 hover:shadow-md hover:border-border/80 cursor-grab active:cursor-grabbing"}`}
    >
      <p className="text-[12px] font-medium leading-snug mb-1 line-clamp-2">{item.name}</p>
      {item.parent && (
        <p className="text-[9px] text-muted-foreground truncate mb-1.5">
          {item.workstream ? `${item.workstream} → ` : ""}{item.parent}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-2">
        {item.endDate && (
          <span className={`text-[9px] tabular-nums ${overdue ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
            {fmtDate(item.endDate)}{overdue && " ⚠"}
          </span>
        )}
        {item.points > 0 && (
          <span className="text-[9px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1 py-0.5 rounded">
            {item.points} pts
          </span>
        )}
      </div>

      {/* Completion bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${pctColor} transition-all duration-300`}
            style={{ width: `${Math.min(editing ? localPct : item.pct, 100)}%` }}
          />
        </div>
        <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-8 text-right">
          {editing ? localPct : item.pct}%
        </span>
      </div>

      {/* Hover actions: status + update progress */}
      {!editing && (
        <div className="mt-2 pt-1.5 border-t border-border/20 opacity-0 group-hover:opacity-100 transition-opacity space-y-1.5">
          <select
            value={item.status}
            onChange={e => onStatusChange(item.id, e.target.value)}
            className="w-full h-6 text-[10px] bg-muted/50 border-0 rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40 cursor-pointer"
          >
            <option value="NOT_STARTED">Not Started</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="BLOCKED">Blocked</option>
            <option value="DONE">Done</option>
          </select>
          <button
            onClick={() => { setLocalPct(item.pct); setComment(""); setError(null); setEditing(true); }}
            className="w-full h-6 text-[10px] font-medium rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors flex items-center justify-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" /></svg>
            Log Progress
          </button>
        </div>
      )}

      {/* Expanded progress log form */}
      {editing && (
        <div className="mt-2 pt-2 border-t border-blue-500/20 space-y-2">
          <div>
            <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">% Complete</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range"
                min={0} max={100} step={5}
                value={localPct}
                onChange={e => setLocalPct(Number(e.target.value))}
                className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
              />
              <input
                type="number"
                min={0} max={100}
                value={localPct}
                onChange={e => setLocalPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="w-12 h-6 text-[10px] text-center font-bold tabular-nums bg-muted/50 border border-border/40 rounded focus:outline-none focus:ring-1 focus:ring-blue-500/40"
              />
            </div>
          </div>
          <div>
            <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
              Comment <span className="text-red-500">*</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="What changed? (required)"
              rows={2}
              className="mt-1 w-full text-[11px] bg-muted/30 border border-border/40 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/40 placeholder:text-muted-foreground/40"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={async () => {
                if (!canSave || saving) return;
                setSaving(true);
                setError(null);
                const err = await onPctChange(item.id, localPct, comment.trim(), item.points);
                setSaving(false);
                if (err) {
                  setError(err);
                } else {
                  setEditing(false);
                }
              }}
              disabled={!canSave || saving}
              className="flex-1 h-7 text-[10px] font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1"
            >
              {saving ? (
                <><svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg> Saving...</>
              ) : (
                <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg> Save &amp; Push to Notion</>
              )}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="h-7 px-3 text-[10px] text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
          {!canSave && comment.trim().length === 0 && localPct !== item.pct && (
            <p className="text-[9px] text-red-500/70">A comment is required to log progress</p>
          )}
          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/20 px-2 py-1.5">
              <p className="text-[10px] text-red-500 font-medium">Failed to save: {error}</p>
            </div>
          )}
        </div>
      )}
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

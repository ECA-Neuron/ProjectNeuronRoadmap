"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRoadmapItem } from "@/lib/actions/update-roadmap-dates";
import { addRoadmapItem } from "@/lib/actions/add-roadmap-item";
import { logProgressUpdate } from "@/lib/actions/log-progress-update";
import { createOpenIssue } from "@/lib/actions/open-issues";
import { DatePicker } from "@/components/ui/date-picker";
import { DashboardOpenIssues } from "./dashboard-open-issues";
import {
  LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
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

interface IssueComment {
  id: string; parentId: string | null; body: string; authorName: string | null; createdAt: string;
  mentions?: { person: { id: string; name: string; initials: string | null } }[];
}

interface DashboardIssue {
  id: string; title: string; severity: string; createdAt: string; resolvedAt: string | null;
  workstream: { id: string; name: string } | null; subTask: { id: string; name: string } | null;
  assignees: { person: { id: string; name: string; initials: string | null } }[];
  comments?: IssueComment[];
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
type FilterTag = "IN_PROGRESS" | "NOT_STARTED" | "BLOCKED" | "DONE" | "OVERDUE" | "PROJECTED_LATE" | "DUE_THIS_MONTH" | "NO_DATE";
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

function toDateStr(d: string): string {
  return d.includes("T") ? d.slice(0, 10) : d;
}

function daysBetween(a: string, b: string): number {
  const da = toDateStr(a), db = toDateStr(b);
  return Math.round((new Date(db + "T12:00:00Z").getTime() - new Date(da + "T12:00:00Z").getTime()) / 86400000);
}

function isDueThisMonth(d: string | null, status: string): boolean {
  if (!d || status === "DONE") return false;
  const ds = d.includes("T") ? d.slice(0, 10) : d;
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0");
  const monthStart = `${y}-${m}-01`;
  const nextMonth = now.getMonth() === 11 ? `${y + 1}-01-01` : `${y}-${String(now.getMonth() + 2).padStart(2, "0")}-01`;
  return ds >= monthStart && ds < nextMonth;
}

function hasNoDate(item: BoardItem): boolean {
  return !item.endDate && !item.startDate;
}

function isProjectedLate(item: BoardItem, featureLookup: Map<string, { startDate: string | null; endDate: string | null; totalPts: number; burntPts: number }>): boolean {
  if (item.status === "DONE" || !item.endDate) return false;
  const fId = item.featureId;
  if (!fId) return false;
  const f = featureLookup.get(fId);
  if (!f || !f.startDate || !f.endDate || f.totalPts === 0) return false;

  const today = new Date().toISOString().slice(0, 10);
  const fStart = toDateStr(f.startDate);
  const sd = fStart < today ? fStart : today;
  const elapsed = daysBetween(sd, today);
  if (elapsed <= 0) return false;

  const remaining = f.totalPts - f.burntPts;
  if (remaining <= 0) return false;

  const velocity = f.burntPts / elapsed;
  if (velocity <= 0) return false;

  const daysToFinish = Math.ceil(remaining / velocity);
  if (!isFinite(daysToFinish) || daysToFinish > 3650) return true;
  try {
    const est = new Date(today + "T12:00:00Z");
    est.setUTCDate(est.getUTCDate() + daysToFinish);
    const estDate = est.toISOString().slice(0, 10);
    const endDate = item.endDate.includes("T") ? item.endDate.slice(0, 10) : item.endDate;
    return estDate > endDate;
  } catch {
    return false;
  }
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

interface PersonOption { id: string; name: string; initials?: string | null }

export function MyDashboardClient({
  userName, tasks, features, openIssues = [], progressLogs = [], workstreams = [], people = [],
}: {
  userName: string; tasks: Task[]; features: Feature[];
  openIssues?: DashboardIssue[]; progressLogs?: ProgressLog[]; workstreams?: WsOption[];
  people?: PersonOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filters, setFilters] = useState<Set<FilterTag>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [showAddTask, setShowAddTask] = useState(false);
  const [showCreateIssue, setShowCreateIssue] = useState(false);
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

  const featureLookup = useMemo(() => {
    const map = new Map<string, { startDate: string | null; endDate: string | null; totalPts: number; burntPts: number }>();
    for (const f of features) {
      const totalPts = f.subTasks.reduce((s, t) => s + t.points, 0);
      const burntPts = f.subTasks.reduce((s, t) => s + Math.round(t.points * t.completionPercent / 100), 0);
      map.set(f.id, { startDate: f.startDate, endDate: f.endDate, totalPts, burntPts });
    }
    return map;
  }, [features]);

  const toggleFilter = useCallback((tag: FilterTag) => {
    setFilters(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => setFilters(new Set()), []);

  const matchesFilter = useCallback((item: BoardItem, tag: FilterTag): boolean => {
    switch (tag) {
      case "IN_PROGRESS": return item.status === "IN_PROGRESS";
      case "NOT_STARTED": return item.status === "NOT_STARTED";
      case "BLOCKED": return item.status === "BLOCKED";
      case "DONE": return item.status === "DONE";
      case "OVERDUE": return isOverdue(item.endDate, item.status);
      case "PROJECTED_LATE": return isProjectedLate(item, featureLookup);
      case "DUE_THIS_MONTH": return isDueThisMonth(item.endDate, item.status);
      case "NO_DATE": return hasNoDate(item);
      default: return false;
    }
  }, [featureLookup]);

  const sortedItems = useMemo(() => {
    let items = [...allSubTasks];
    if (filters.size > 0) {
      items = items.filter(i => [...filters].every(tag => matchesFilter(i, tag)));
    }
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
  }, [allSubTasks, filters, matchesFilter, search, sortKey, wsFilter, featureFilter]);

  const stats = useMemo(() => {
    const all = allSubTasks;
    return {
      total: all.length,
      done: all.filter(t => t.status === "DONE").length,
      inProgress: all.filter(t => t.status === "IN_PROGRESS").length,
      blocked: all.filter(t => t.status === "BLOCKED").length,
      projectedLate: all.filter(t => isProjectedLate(t, featureLookup)).length,
      overdue: all.filter(t => isOverdue(t.endDate, t.status)).length,
      totalPoints: all.reduce((s, t) => s + (t.points || 0), 0),
      donePoints: all.filter(t => t.status === "DONE").reduce((s, t) => s + (t.points || 0), 0),
    };
  }, [allSubTasks, featureLookup]);

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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <StatCard label="Total Tasks" value={stats.total} />
        <StatCard label="In Progress" value={stats.inProgress} accent="text-blue-600 dark:text-blue-400" />
        <StatCard label="Blocked" value={stats.blocked} accent="text-red-600 dark:text-red-400" />
        <StatCard label="Completed" value={stats.done} accent="text-emerald-600 dark:text-emerald-400" />
        <StatCard label="Overdue" value={stats.overdue} accent="text-orange-600 dark:text-orange-400" />
        <StatCard label="At Risk" value={stats.projectedLate} accent="text-rose-600 dark:text-rose-400" />
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

      {/* ── My Charts (per-feature burndowns) ── */}
      {features.length > 0 && (
        <MyChartsSection features={features} progressLogs={progressLogs} />
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

          {/* Filters (multi-select) */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={clearFilters}
              className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-lg border transition-all ${filters.size === 0 ? "bg-foreground/[0.08] text-foreground border-foreground/20 shadow-sm" : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"}`}
            >
              All
            </button>
            {([
              { key: "IN_PROGRESS" as FilterTag, label: "In Progress", dot: "bg-blue-500", activeBg: "bg-blue-500/15 border-blue-500/40 text-blue-600 dark:text-blue-400" },
              { key: "NOT_STARTED" as FilterTag, label: "Not Started", dot: "bg-gray-400", activeBg: "bg-gray-500/15 border-gray-500/40 text-gray-600 dark:text-gray-400" },
              { key: "BLOCKED" as FilterTag, label: "Blocked", dot: "bg-red-500", activeBg: "bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-400" },
              { key: "DONE" as FilterTag, label: "Done", dot: "bg-emerald-500", activeBg: "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
            ]).map(({ key, label, dot, activeBg }) => {
              const active = filters.has(key);
              return (
                <button key={key} onClick={() => toggleFilter(key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg border transition-all ${active ? `${activeBg} shadow-sm` : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"}`}
                >
                  <span className={`w-2 h-2 rounded-full ${dot} ${active ? "ring-2 ring-offset-1 ring-offset-background" : ""}`} />
                  {label}
                </button>
              );
            })}
            <span className="w-px h-5 bg-border/60 mx-1" />
            {([
              { key: "OVERDUE" as FilterTag, label: "Overdue", dot: "bg-orange-500", activeBg: "bg-orange-500/15 border-orange-500/40 text-orange-600 dark:text-orange-400" },
              { key: "PROJECTED_LATE" as FilterTag, label: "At Risk", dot: "bg-rose-500", activeBg: "bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-400" },
              { key: "DUE_THIS_MONTH" as FilterTag, label: "Due This Month", dot: "bg-violet-500", activeBg: "bg-violet-500/15 border-violet-500/40 text-violet-600 dark:text-violet-400" },
              { key: "NO_DATE" as FilterTag, label: "No Date", dot: "bg-gray-400", activeBg: "bg-gray-500/15 border-gray-500/40 text-gray-600 dark:text-gray-400" },
            ]).map(({ key, label, dot, activeBg }) => {
              const active = filters.has(key);
              return (
                <button key={key} onClick={() => toggleFilter(key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg border transition-all ${active ? `${activeBg} shadow-sm` : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"}`}
                >
                  <span className={`w-2 h-2 rounded-full ${dot} ${active ? "ring-2 ring-offset-1 ring-offset-background" : ""}`} />
                  {label}
                </button>
              );
            })}
            {filters.size > 0 && (
              <button onClick={clearFilters} className="text-[9px] text-muted-foreground hover:text-foreground underline ml-1">
                Clear all
              </button>
            )}
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
          <h2 className="text-sm font-semibold mb-3">
            All My Tasks <span className="text-muted-foreground font-normal">({sortedItems.length}{filters.size > 0 ? ` of ${allSubTasks.length}` : ""})</span>
            {filters.size > 0 && <span className="ml-2 text-[9px] font-medium text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">{filters.size} filter{filters.size > 1 ? "s" : ""} active</span>}
          </h2>
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
          <h2 className="text-sm font-semibold mb-3">
            All My Tasks <span className="text-muted-foreground font-normal">({sortedItems.length}{filters.size > 0 ? ` of ${allSubTasks.length}` : ""})</span>
            {filters.size > 0 && <span className="ml-2 text-[9px] font-medium text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded">{filters.size} filter{filters.size > 1 ? "s" : ""} active</span>}
          </h2>
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

      {/* ── Open Issues (inline with comments) ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Open Issues</h2>
            {openIssues.length > 0 && (
              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md">
                {openIssues.length} issue{openIssues.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <button
            onClick={() => setShowCreateIssue(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Create Issue
          </button>
        </div>

        {showCreateIssue && (
          <CreateIssueInline
            workstreams={workstreams}
            people={people}
            onCreated={() => { setShowCreateIssue(false); router.refresh(); }}
            onCancel={() => setShowCreateIssue(false)}
          />
        )}

        {openIssues.length > 0 ? (
          <DashboardOpenIssues
            issues={openIssues as any}
            people={people.map(p => ({ id: p.id, name: p.name, initials: (p as any).initials ?? null }))}
          />
        ) : !showCreateIssue ? (
          <div className="rounded-xl border border-border/60 bg-card p-8 text-center shadow-card">
            <p className="text-xs text-muted-foreground">No open issues assigned to you.</p>
          </div>
        ) : null}
      </section>

      {/* ── Add Task Modal ── */}
      {showAddTask && (
        <AddTaskModal
          workstreams={workstreams}
          people={people}
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

const RISK_LEVELS = [
  { value: "Low", label: "Low (+1)" },
  { value: "Medium", label: "Medium (+2)" },
  { value: "High", label: "High (+3)" },
  { value: "Very High", label: "Very High (+4)" },
];

function modalCalcPoints(days: number, risk: string): number {
  if (!days || days <= 0) return 0;
  switch (risk) {
    case "Very High": return Math.ceil(days + 4);
    case "High":      return Math.ceil(days + 3);
    case "Medium":    return Math.ceil(days + 2);
    case "Low":       return Math.ceil(days < 1 ? days * 2 : days + 1);
    default:          return Math.ceil(days);
  }
}

function AddTaskModal({ workstreams, people, onClose, onSaved }: { workstreams: WsOption[]; people: PersonOption[]; onClose: () => void; onSaved: () => void }) {
  const [wsId, setWsId] = useState("");
  const [delId, setDelId] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("NOT_STARTED");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [estimatedDays, setEstimatedDays] = useState("");
  const [riskLevel, setRiskLevel] = useState("Medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);

  const activeWs = workstreams.find(w => w.id === wsId);
  const deliverables = activeWs?.deliverables ?? [];
  const activeDel = deliverables.find(d => d.id === delId);
  const features = activeDel ? activeDel.initiatives : (activeWs?.initiatives ?? []);

  const handleWs = (v: string) => { setWsId(v); setDelId(""); setFeatureId(""); };
  const handleDel = (v: string) => { setDelId(v); setFeatureId(""); };

  const parsedDays = estimatedDays ? parseFloat(estimatedDays) : 0;
  const computedPoints = modalCalcPoints(parsedDays, riskLevel);

  const handleCreate = async () => {
    if (!name.trim() || !featureId || saving) return;
    setSaving(true);
    try {
      const days = estimatedDays ? parseFloat(estimatedDays) : null;
      await addRoadmapItem({
        level: "Task",
        name: name.trim(),
        parentId: featureId,
        status,
        estimatedDays: days,
        riskLevel,
        startDate: startDate || null,
        endDate: endDate || null,
        assigneeId: assigneeId || null,
      });
      onSaved();
    } catch (err) {
      console.error("Failed to create task:", err);
      setSaving(false);
    }
  };

  const labelCls = "block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1";
  const fieldCls = "w-full h-8 text-[12px] bg-background text-foreground border border-border/60 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-elevated border border-border/60 p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">Add New Task</h3>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs">✕</button>
        </div>
        <div className="space-y-3">
          {/* Hierarchy */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Workstream *</label>
              <select value={wsId} onChange={e => handleWs(e.target.value)} className={fieldCls}>
                <option value="">Select…</option>
                {workstreams.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Deliverable</label>
              <select value={delId} onChange={e => handleDel(e.target.value)} disabled={!wsId} className={`${fieldCls} disabled:opacity-40`}>
                <option value="">All / None</option>
                {deliverables.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Feature *</label>
              <select value={featureId} onChange={e => setFeatureId(e.target.value)} disabled={!wsId} className={`${fieldCls} disabled:opacity-40`}>
                <option value="">Select…</option>
                {features.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>

          {/* Task Name */}
          <div>
            <label className={labelCls}>Task Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="What needs to be done?" className={fieldCls} autoFocus />
          </div>

          {/* Estimation row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Estimated Days</label>
              <input type="number" min={0} step="0.5" value={estimatedDays} onChange={e => setEstimatedDays(e.target.value)} placeholder="e.g. 2.5" className={fieldCls} />
            </div>
            <div>
              <label className={labelCls}>Risk Level</label>
              <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} className={fieldCls}>
                {RISK_LEVELS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Points</label>
              <div className="h-8 flex items-center text-xs font-semibold text-blue-600 dark:text-blue-400 px-3 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800 rounded-lg">
                {computedPoints || "—"}
              </div>
            </div>
          </div>

          {/* Status + Dates */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={fieldCls}>
                <option value="NOT_STARTED">Not Started</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="BLOCKED">Blocked</option>
                <option value="DONE">Done</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Start</label>
              <DatePicker value={startDate} onChange={setStartDate} placeholder="Start date" className="h-8 text-[12px] rounded-lg border-border/60" />
            </div>
            <div>
              <label className={labelCls}>End</label>
              <DatePicker value={endDate} onChange={setEndDate} placeholder="End date" className="h-8 text-[12px] rounded-lg border-border/60" />
            </div>
          </div>

          {/* Assignee */}
          {people.length > 0 && (
            <div>
              <label className={labelCls}>Assignee</label>
              <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={fieldCls}>
                <option value="">Unassigned</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button onClick={handleCreate} disabled={!name.trim() || !featureId || saving} className="flex-1 h-9 text-[12px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
              {saving ? "Creating…" : "Create Task"}
            </button>
            <button onClick={onClose} disabled={saving} className="h-9 px-4 text-[12px] text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Create Issue Inline ────────────────────────────

function CreateIssueInline({ workstreams, people, onCreated, onCancel }: {
  workstreams: WsOption[]; people: PersonOption[]; onCreated: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("NOT_A_CONCERN");
  const [wsId, setWsId] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAssignee = (id: string) => {
    setAssigneeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCreate = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createOpenIssue({
        title: title.trim(),
        severity,
        workstreamId: wsId || null,
        description: description.trim() || null,
        assigneeIds,
      });
      if (!result.success) {
        setError(result.error);
        setSaving(false);
        return;
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue");
      setSaving(false);
    }
  };

  const labelCls = "block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1";
  const fieldCls = "w-full h-8 text-[12px] bg-background text-foreground border border-border/60 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-colors";

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.03] p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-amber-600 dark:text-amber-400">New Issue</h3>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>

      <div>
        <label className={labelCls}>Title *</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Issue description..." className={fieldCls} autoFocus />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Severity</label>
          <div className="flex gap-1.5">
            {(["STOPPING", "SLOWING", "NOT_A_CONCERN"] as const).map(s => {
              const cfg = SEV_CONFIG[s];
              return (
                <button key={s} type="button" onClick={() => setSeverity(s)}
                  className={`flex-1 h-8 text-[10px] font-semibold rounded-lg border transition-all ${severity === s ? `${cfg.bg} ${cfg.text} ${cfg.border} ring-1 ring-offset-1` : "border-border/40 text-muted-foreground hover:border-border"}`}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className={labelCls}>Workstream</label>
          <select value={wsId} onChange={e => setWsId(e.target.value)} className={fieldCls}>
            <option value="">Unassigned</option>
            {workstreams.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Details (optional)..." rows={2}
          className="w-full text-[12px] bg-background text-foreground border border-border/60 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/30 resize-none" />
      </div>

      {people.length > 0 && (
        <div>
          <label className={labelCls}>Assignees</label>
          <div className="flex flex-wrap gap-1.5">
            {people.map(p => (
              <button key={p.id} type="button" onClick={() => toggleAssignee(p.id)}
                className={`text-[10px] px-2 py-1 rounded-md border transition-all ${assigneeIds.includes(p.id) ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40 font-semibold" : "border-border/40 text-muted-foreground hover:border-border"}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button onClick={handleCreate} disabled={!title.trim() || saving}
          className="h-8 px-4 text-[12px] font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 transition-colors">
          {saving ? "Creating..." : "Create Issue"}
        </button>
        <button onClick={onCancel} disabled={saving} className="h-8 px-3 text-[12px] text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors">Cancel</button>
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

// ─── My Charts Sidebar ──────────────────────────────

interface DayLog {
  taskName: string;
  comment: string | null;
  by: string | null;
  pts: number;
}

interface MiniBurnPoint {
  label: string;
  date: string;
  ideal: number;
  actual: number | null;
  projected: number | null;
  dayLogs: DayLog[];
}

interface TaskSummary {
  id: string; name: string; pct: number; points: number;
  status: "done" | "on-track" | "off-track" | "not-started";
  assignee: string | null;
}

interface FeatureChartData {
  id: string; name: string; wsName: string;
  totalPts: number; burntPts: number; pct: number;
  status: "on-track" | "off-track" | "ahead" | "done" | "no-data";
  velocity: number; estCompletion: string | null; daysOff: number;
  data: MiniBurnPoint[];
  deadlineLabel: string | null;
  projectedLabel: string | null;
  tasks: TaskSummary[];
}

function buildFeatureChart(feature: Feature, logs: ProgressLog[]): FeatureChartData {
  const totalPts = feature.subTasks.reduce((s, t) => s + t.points, 0);
  const burntPts = feature.subTasks.reduce((s, t) => s + Math.round(t.points * t.completionPercent / 100), 0);
  const pct = totalPts > 0 ? Math.round((burntPts / totalPts) * 100) : 0;
  const wsName = feature.workstream?.name ?? "";

  const sd = feature.startDate?.slice(0, 10) ?? null;
  const ed = feature.endDate?.slice(0, 10) ?? null;
  const today = new Date().toISOString().slice(0, 10);

  const featureLogs = logs.filter(l => l.initiativeId === feature.id || feature.subTasks.some(t => t.id === l.subTaskId));
  const dated = featureLogs.filter(l => l.logDate).sort((a, b) => String(a.logDate!).localeCompare(String(b.logDate!)));

  const buildTasks = (): TaskSummary[] => {
    const now = new Date().toISOString().slice(0, 10);
    return feature.subTasks.map(t => {
      const tPct = t.completionPercent;
      let tStatus: TaskSummary["status"];
      if (tPct >= 100) {
        tStatus = "done";
      } else if (tPct === 0) {
        tStatus = "not-started";
      } else {
        const tEnd = t.endDate?.slice(0, 10) ?? ed;
        if (tEnd && tEnd < now) {
          tStatus = "off-track";
        } else if (tEnd) {
          const tStart = t.startDate?.slice(0, 10) ?? sd ?? now;
          const totalSpan = Math.max(daysBetween(tStart, tEnd), 1);
          const elapsed = Math.max(daysBetween(tStart, now), 0);
          const expectedPct = Math.min((elapsed / totalSpan) * 100, 100);
          tStatus = tPct >= expectedPct * 0.85 ? "on-track" : "off-track";
        } else {
          tStatus = "on-track";
        }
      }
      return { id: t.id, name: t.name, pct: tPct, points: t.points, status: tStatus, assignee: t.assignee?.initials ?? t.assignee?.name ?? null };
    });
  };

  if (totalPts === 0) {
    return { id: feature.id, name: feature.name, wsName, totalPts, burntPts, pct, status: "no-data", velocity: 0, estCompletion: null, daysOff: 0, data: [], deadlineLabel: null, projectedLabel: null, tasks: buildTasks() };
  }

  const logsByDay = new Map<string, DayLog[]>();
  const burnByDay = new Map<string, number>();
  for (const log of dated) {
    const d = String(log.logDate!).slice(0, 10);
    burnByDay.set(d, (burnByDay.get(d) ?? 0) + (log.currentPoints ?? 0));
    const arr = logsByDay.get(d) ?? [];
    arr.push({ taskName: log.taskName ?? "", comment: log.updateComment ?? null, by: log.completedBy ?? null, pts: log.currentPoints ?? 0 });
    logsByDay.set(d, arr);
  }

  const hasDates = !!(sd && ed);
  const fmtLabel = (iso: string) =>
    new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  let rangeStart: string;
  let deadlineDate: string | null = ed ?? null;
  if (hasDates) {
    rangeStart = sd!;
  } else {
    const logDates = dated.map(l => String(l.logDate!).slice(0, 10));
    rangeStart = logDates[0] ?? today;
  }

  // First pass: compute velocity from rangeStart→ed (or today) to know estCompletion
  const firstPassEnd = deadlineDate ?? today;
  const tempDays: string[] = [];
  {
    const c = new Date(rangeStart + "T12:00:00Z");
    const e = new Date((firstPassEnd > today ? firstPassEnd : today) + "T12:00:00Z");
    while (c <= e) { tempDays.push(c.toISOString().slice(0, 10)); c.setUTCDate(c.getUTCDate() + 1); }
  }
  let tempBurnt = 0;
  for (const d of tempDays) { if (d <= today) tempBurnt += burnByDay.get(d) ?? 0; }
  const tempTodayIdx = tempDays.findIndex(d => d >= today);
  const tempEffective = tempTodayIdx >= 0 ? tempTodayIdx : tempDays.length - 1;
  const tempRemaining = totalPts - tempBurnt;
  const tempVelocity = (tempEffective + 1) > 0 ? tempBurnt / (tempEffective + 1) : 0;

  let estCompletion: string | null = null;
  let daysOff = 0;
  if (tempVelocity > 0 && tempRemaining > 0) {
    const daysToFinish = Math.ceil(tempRemaining / tempVelocity);
    if (isFinite(daysToFinish) && daysToFinish <= 3650) {
      const est = new Date(today + "T12:00:00Z");
      est.setUTCDate(est.getUTCDate() + daysToFinish);
      estCompletion = est.toISOString().slice(0, 10);
      if (ed) daysOff = daysBetween(ed, estCompletion);
    }
  }

  // Determine the actual range end: extend to include projected date if it's past deadline
  let rangeEnd: string;
  if (hasDates) {
    rangeEnd = ed!;
    if (estCompletion && estCompletion > rangeEnd) rangeEnd = estCompletion;
  } else {
    rangeEnd = today;
    if (estCompletion && estCompletion > rangeEnd) rangeEnd = estCompletion;
    if (rangeStart === rangeEnd) {
      const d = new Date(rangeStart + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + 14);
      rangeEnd = d.toISOString().slice(0, 10);
    }
  }

  const allDays: string[] = [];
  const cur = new Date(rangeStart + "T12:00:00Z");
  const endD = new Date(rangeEnd + "T12:00:00Z");
  while (cur <= endD) { allDays.push(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
  if (allDays.length === 0) return { id: feature.id, name: feature.name, wsName, totalPts, burntPts, pct, status: "no-data", velocity: 0, estCompletion: null, daysOff: 0, data: [], deadlineLabel: null, projectedLabel: null, tasks: buildTasks() };

  const todayIdx = allDays.findIndex(d => d >= today);
  const effectiveTodayIdx = todayIdx >= 0 ? todayIdx : allDays.length - 1;
  // Ideal burn uses the deadline, not the extended range
  const deadlineIdx = deadlineDate ? allDays.findIndex(d => d >= deadlineDate!) : -1;
  const idealSpan = deadlineIdx >= 0 ? deadlineIdx : allDays.length - 1;
  const idealPerDay = hasDates ? totalPts / Math.max(idealSpan, 1) : 0;

  let cumBurnt = 0;
  const points: MiniBurnPoint[] = allDays.map((day, idx) => {
    const ideal = hasDates ? Math.max(0, Math.round(totalPts - idealPerDay * Math.min(idx, idealSpan))) : 0;
    const dayBurn = burnByDay.get(day) ?? 0;
    cumBurnt += dayBurn;
    const isPast = day <= today;
    const actual = isPast ? Math.max(0, totalPts - cumBurnt) : null;
    const dl = logsByDay.get(day) ?? [];
    return {
      label: fmtLabel(day),
      date: day, ideal, actual, projected: null, dayLogs: dl,
    };
  });

  const anchorRemaining = points[effectiveTodayIdx]?.actual ?? totalPts;
  const logBurnt = totalPts - anchorRemaining;
  const velocity = (effectiveTodayIdx + 1) > 0 ? logBurnt / (effectiveTodayIdx + 1) : 0;

  if (velocity > 0 && effectiveTodayIdx >= 0) {
    points[effectiveTodayIdx].projected = anchorRemaining;
    for (let i = effectiveTodayIdx + 1; i < points.length; i++) {
      points[i].projected = Math.max(0, Math.round(anchorRemaining - velocity * (i - effectiveTodayIdx)));
    }
  }

  const remaining = totalPts - logBurnt;

  let status: FeatureChartData["status"];
  if (!hasDates) {
    status = remaining <= 0 ? "done" : logBurnt > 0 ? "on-track" : "no-data";
  } else {
    const totalDays = daysBetween(sd!, ed!);
    const idealBurnPerDay2 = totalPts / Math.max(totalDays, 1);
    const elapsedFromStart = daysBetween(sd!, today);
    const idealBurnt = idealBurnPerDay2 * Math.min(elapsedFromStart, totalDays);
    if (remaining <= 0) status = "done";
    else if (logBurnt >= idealBurnt * 0.95) status = logBurnt > idealBurnt * 1.1 ? "ahead" : "on-track";
    else status = "off-track";
  }

  const deadlineLabel = deadlineDate ? fmtLabel(deadlineDate) : null;
  const projectedLabel = estCompletion ? fmtLabel(estCompletion) : null;

  return { id: feature.id, name: feature.name, wsName, totalPts, burntPts, pct, status, velocity, estCompletion, daysOff, data: points, deadlineLabel, projectedLabel, tasks: buildTasks() };
}

const TRACK_BADGE: Record<string, { label: string; cls: string }> = {
  "on-track": { label: "On Track", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  "off-track": { label: "Off Track", cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
  "ahead": { label: "Ahead", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  "done": { label: "Done", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  "no-data": { label: "No Data", cls: "bg-muted text-muted-foreground" },
};

function MiniChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload as MiniBurnPoint | undefined;
  if (!pt) return null;
  return (
    <div className="bg-card border border-border/60 rounded-lg shadow-elevated p-3 max-w-[280px] text-xs z-50 backdrop-blur-sm">
      <p className="font-semibold text-[11px] mb-1.5">{pt.date ? new Date(pt.date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : pt.label}</p>
      <div className="flex gap-3 mb-1 text-[10px]">
        {pt.ideal > 0 && <span className="text-blue-500 tabular-nums">Ideal: {pt.ideal}</span>}
        {pt.actual !== null && <span className="text-orange-500 tabular-nums">Actual: {pt.actual}</span>}
        {pt.projected !== null && pt.actual === null && <span className="text-orange-400 tabular-nums">Proj: {pt.projected}</span>}
      </div>
      {pt.dayLogs.length > 0 && (
        <div className="border-t border-border/40 pt-1.5 mt-1.5 space-y-1 max-h-[150px] overflow-y-auto">
          {pt.dayLogs.map((l, i) => (
            <div key={i} className="text-muted-foreground">
              <span className="font-medium text-foreground text-[10px]">{l.taskName}</span>
              {l.pts > 0 && <span className="text-emerald-500 ml-1 font-semibold tabular-nums text-[9px]">+{l.pts.toFixed(1)}</span>}
              {l.by && <span className="ml-1 text-[9px]">by {l.by}</span>}
              {l.comment && <p className="text-[9px] mt-0.5 italic leading-tight line-clamp-2 text-muted-foreground/70">{l.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniActualDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  if (payload?.dayLogs?.length > 0) {
    return <circle cx={cx} cy={cy} r={3.5} fill="#10b981" stroke="#fff" strokeWidth={1.5} />;
  }
  return <circle cx={cx} cy={cy} r={1} fill="#f97316" stroke="none" />;
}

const TASK_STATUS_CFG: Record<TaskSummary["status"], { dot: string; label: string }> = {
  "done": { dot: "bg-emerald-500", label: "Done" },
  "on-track": { dot: "bg-blue-500", label: "On Track" },
  "off-track": { dot: "bg-red-500", label: "Off Track" },
  "not-started": { dot: "bg-zinc-400", label: "Not Started" },
};

function QuickUpdateTaskRow({ task, totalFeaturePts }: { task: TaskSummary; totalFeaturePts: number }) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(task.pct);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const cfg = TASK_STATUS_CFG[task.status];

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const clamped = Math.max(0, Math.min(100, pct));
      const currentPoints = Math.round((task.points * clamped) / 100);
      await logProgressUpdate({
        subTaskId: task.id,
        currentPoints,
        totalPoints: task.points,
        percentComplete: clamped,
        comment,
      });
      setSaved(true);
      setComment("");
      setTimeout(() => { setSaved(false); setOpen(false); }, 1200);
      router.refresh();
    } catch {
      alert("Failed to save update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        className="flex items-center gap-1.5 text-[9px] group cursor-pointer rounded px-1 py-0.5 hover:bg-accent/30 transition-colors"
        onClick={() => { setOpen(v => !v); setPct(task.pct); setComment(""); setSaved(false); }}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} title={cfg.label} />
        <span className="min-w-0 flex-1 truncate" title={task.name}>{task.name}</span>
        {task.assignee && <span className="text-[8px] text-muted-foreground/60 shrink-0">{task.assignee}</span>}
        <div className="w-10 h-1 rounded-full bg-muted overflow-hidden shrink-0">
          <div
            className={`h-full rounded-full ${task.status === "done" ? "bg-emerald-500" : task.status === "off-track" ? "bg-red-500" : task.status === "on-track" ? "bg-blue-500" : "bg-zinc-400"}`}
            style={{ width: `${Math.min(task.pct, 100)}%` }}
          />
        </div>
        <span className="w-7 text-right tabular-nums font-semibold shrink-0">{task.pct}%</span>
      </div>

      {open && (
        <div className="ml-3 mr-1 mt-1 mb-1.5 rounded-md border border-border/40 bg-background/80 p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="text-[8px] text-muted-foreground shrink-0 w-5">%</label>
            <input
              type="range"
              min={0} max={100} step={5}
              value={pct}
              onChange={e => setPct(Number(e.target.value))}
              className="flex-1 h-1 accent-blue-500 cursor-pointer"
            />
            <input
              type="number"
              min={0} max={100}
              value={pct}
              onChange={e => setPct(Math.max(0, Math.min(100, Number(e.target.value))))}
              className="w-10 text-[9px] tabular-nums text-center rounded border border-border/50 bg-transparent py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            />
          </div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Comment (optional)..."
            rows={2}
            className="w-full text-[9px] rounded border border-border/50 bg-transparent px-1.5 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/40 placeholder:text-muted-foreground/50"
          />
          <div className="flex items-center justify-end gap-1.5">
            {saved && <span className="text-[8px] text-emerald-500 font-medium">Saved!</span>}
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              className="text-[8px] px-2 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleSave(); }}
              disabled={saving || (pct === task.pct && !comment.trim())}
              className="text-[8px] px-2.5 py-0.5 rounded font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving..." : "Update"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureChartCard({ chart }: { chart: FeatureChartData }) {
  const [showLogs, setShowLogs] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const badge = TRACK_BADGE[chart.status];
  const hasIdeal = chart.data.some(d => d.ideal > 0);

  const recentLogs = useMemo(() => {
    const all: DayLog[] = [];
    for (const pt of chart.data) {
      for (const l of pt.dayLogs) all.push(l);
    }
    return all.slice(-5).reverse();
  }, [chart.data]);

  const showDeadlineLine = !!chart.deadlineLabel;
  const showProjectedLine = !!chart.projectedLabel && chart.projectedLabel !== chart.deadlineLabel;

  return (
    <div className={`rounded-lg border p-3 space-y-2 transition-all ${chart.status === "off-track" ? "border-red-500/30 bg-red-500/[0.03]" : chart.status === "done" ? "border-emerald-500/30 bg-emerald-500/[0.03]" : "border-border/40 bg-background/50"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold truncate leading-tight" title={chart.name}>{chart.name}</p>
          {chart.wsName && <p className="text-[9px] text-muted-foreground truncate">{chart.wsName}</p>}
        </div>
        <span className={`shrink-0 text-[8px] font-semibold px-1.5 py-0.5 rounded-md ${badge.cls}`}>{badge.label}</span>
      </div>

      <div className="flex items-center gap-2 text-[10px]">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-300 ${chart.pct >= 100 ? "bg-emerald-500" : chart.status === "off-track" ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${Math.min(chart.pct, 100)}%` }} />
        </div>
        <span className="font-semibold tabular-nums shrink-0">{chart.pct}%</span>
      </div>

      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
        <span className="tabular-nums">{chart.burntPts}/{chart.totalPts} pts</span>
        {chart.velocity > 0 && <span className="tabular-nums">{chart.velocity.toFixed(1)} pts/d</span>}
        {!hasIdeal && <span className="text-[8px] italic">No dates set</span>}
      </div>

      {chart.data.length > 0 && (
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={chart.data} margin={{ top: 2, right: 2, left: -24, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 6 }} interval={Math.max(Math.floor(chart.data.length / 3) - 1, 0)} />
            <YAxis tick={{ fontSize: 6 }} width={28} domain={[0, "auto"]} />
            <ReTooltip content={<MiniChartTooltip />} />
            {showDeadlineLine && (
              <ReferenceLine
                x={chart.deadlineLabel!}
                stroke="#3b82f6"
                strokeWidth={1.5}
                strokeDasharray="3 2"
                label={{ value: "Due", position: "insideTopRight", fill: "#3b82f6", fontSize: 8, fontWeight: 700 }}
              />
            )}
            {showProjectedLine && (
              <ReferenceLine
                x={chart.projectedLabel!}
                stroke={chart.daysOff > 0 ? "#ef4444" : "#10b981"}
                strokeWidth={1.5}
                strokeDasharray="3 2"
                label={{ value: "Est", position: "insideTopLeft", fill: chart.daysOff > 0 ? "#ef4444" : "#10b981", fontSize: 8, fontWeight: 700 }}
              />
            )}
            {hasIdeal && <Line type="monotone" dataKey="ideal" stroke="#3b82f6" strokeWidth={1} dot={false} strokeDasharray="4 3" name="Ideal" />}
            <Line type="monotone" dataKey="actual" stroke="#f97316" strokeWidth={1.5} dot={<MiniActualDot />} activeDot={{ r: 4, fill: "#10b981", stroke: "#fff", strokeWidth: 1.5 }} connectNulls={false} name="Actual" />
            <Line type="linear" dataKey="projected" stroke="#f97316" strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls={false} name="Projected" />
          </LineChart>
        </ResponsiveContainer>
      )}

      {(showDeadlineLine || showProjectedLine) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[8px] tabular-nums">
          {showDeadlineLine && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0 border-t-[1.5px] border-dashed border-blue-500 inline-block" />
              <span className="text-blue-500 font-semibold">Due {chart.deadlineLabel}</span>
            </span>
          )}
          {showProjectedLine && (
            <span className="flex items-center gap-1">
              <span className={`w-3 h-0 border-t-[1.5px] border-dashed inline-block ${chart.daysOff > 0 ? "border-red-500" : "border-emerald-500"}`} />
              <span className={`font-semibold ${chart.daysOff > 0 ? "text-red-500" : "text-emerald-500"}`}>
                Est {chart.projectedLabel}{chart.daysOff > 0 ? ` (${chart.daysOff}d late)` : chart.daysOff < 0 ? ` (${Math.abs(chart.daysOff)}d early)` : ""}
              </span>
            </span>
          )}
        </div>
      )}

      {!showDeadlineLine && chart.estCompletion && (
        <p className="text-[8px] tabular-nums text-muted-foreground">
          Est completion: {new Date(chart.estCompletion + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
        </p>
      )}

      {recentLogs.length > 0 && (
        <div className="pt-1">
          <button onClick={() => setShowLogs(v => !v)} className="text-[9px] text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1">
            <svg className={`w-2.5 h-2.5 transition-transform ${showLogs ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
            {showLogs ? "Hide" : "Show"} recent updates ({recentLogs.length})
          </button>
          {showLogs && (
            <div className="mt-1.5 space-y-1.5 max-h-[120px] overflow-y-auto">
              {recentLogs.map((l, i) => (
                <div key={i} className="text-[9px] flex items-start gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1 shrink-0" />
                  <div className="min-w-0">
                    <span className="font-medium text-foreground">{l.taskName}</span>
                    {l.pts > 0 && <span className="text-emerald-500 ml-1 font-semibold tabular-nums">+{l.pts.toFixed(1)}</span>}
                    {l.by && <span className="text-muted-foreground ml-1">by {l.by}</span>}
                    {l.comment && <p className="text-muted-foreground/70 italic leading-tight mt-0.5 line-clamp-1">{l.comment}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {chart.tasks.length > 0 && (
        <div className="border-t border-border/30 pt-1.5 mt-1">
          <button onClick={() => setShowTasks(v => !v)} className="w-full flex items-center justify-between text-[9px] font-medium text-muted-foreground hover:text-foreground transition-colors">
            <span className="flex items-center gap-1">
              <svg className={`w-2.5 h-2.5 transition-transform ${showTasks ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
              Tasks ({chart.tasks.length})
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              {chart.tasks.filter(t => t.status === "off-track").length > 0 && <span className="text-red-500">{chart.tasks.filter(t => t.status === "off-track").length} off track</span>}
              {chart.tasks.filter(t => t.status === "done").length > 0 && <span className="text-emerald-500">{chart.tasks.filter(t => t.status === "done").length} done</span>}
            </span>
          </button>
          {showTasks && (
            <div className="mt-1.5 space-y-0.5 max-h-[280px] overflow-y-auto">
              {chart.tasks
                .sort((a, b) => {
                  const ord: Record<string, number> = { "off-track": 0, "on-track": 1, "not-started": 2, "done": 3 };
                  return (ord[a.status] ?? 9) - (ord[b.status] ?? 9);
                })
                .map(t => <QuickUpdateTaskRow key={t.id} task={t} totalFeaturePts={chart.totalPts} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MyChartsSection({ features, progressLogs }: { features: Feature[]; progressLogs: ProgressLog[] }) {
  const [expanded, setExpanded] = useState(true);
  const charts = useMemo(() =>
    features
      .map(f => buildFeatureChart(f, progressLogs))
      .filter(c => c.totalPts > 0)
      .sort((a, b) => {
        const order: Record<string, number> = { "off-track": 0, "on-track": 1, "ahead": 2, "done": 3, "no-data": 4 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      }),
    [features, progressLogs]
  );

  if (charts.length === 0) return null;

  const offTrack = charts.filter(c => c.status === "off-track").length;
  const onTrack = charts.filter(c => c.status === "on-track" || c.status === "ahead").length;

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-card overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-accent/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-semibold">My Feature Burndowns</h2>
          <span className="text-[10px] text-muted-foreground">{charts.length} feature{charts.length !== 1 ? "s" : ""}</span>
          {offTrack > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-red-500/10 text-red-600 dark:text-red-400">{offTrack} off track</span>}
          {onTrack > 0 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">{onTrack} on track</span>}
        </div>
        <svg className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
      </button>

      {expanded && (
        <div className="border-t border-border/40 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {charts.map(chart => <FeatureChartCard key={chart.id} chart={chart} />)}
          </div>
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

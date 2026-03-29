"use client";

import { useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

const OverviewBurndownChart = dynamic(
  () => import("./overview-burndown-chart").then(m => m.default),
  { ssr: false, loading: () => <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">Loading chart...</div> }
);

// ─── Types ───────────────────────────────────────────

interface SubTask {
  id: string; name: string; status: string; points: number;
  completionPercent: number; startDate: string | null; endDate: string | null;
  assignee: { id: string; name: string; initials: string | null } | null;
}

interface Initiative {
  id: string; name: string; status: string;
  subTasks: SubTask[];
}

interface Deliverable {
  id: string; name: string; status: string;
  initiatives: Initiative[];
}

interface Workstream {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  color: string | null;
  deliverables: Deliverable[];
  initiatives: Initiative[];
}

interface OpenIssue {
  id: string; title: string; severity: string; createdAt: string;
  workstream: { id: string; name: string };
}

interface LogEntry {
  id: string; taskName: string; updateComment: string | null;
  completedBy: string | null; logDate: string;
  percentComplete: number | null; currentPoints: number | null; totalPoints: number | null;
  subTask: { name: string } | null;
  initiative: { name: string } | null;
  workstream: { name: string } | null;
}

interface ProgressLogEntry {
  id: string; taskName: string; logDate: string | null;
  totalPoints: number | null; currentPoints: number | null;
  percentComplete: number | null; updateComment: string | null; completedBy: string | null;
  workstreamId: string | null; deliverableId: string | null;
  initiativeId: string | null; subTaskId: string | null;
  subTask: { name: string } | null;
  initiative: { name: string } | null;
}

interface BurnPoint {
  date: string;
  label: string;
  idealRemaining: number;
  actualRemaining: number | null;
  projectedRemaining: number | null;
}

interface Props {
  workstreams: Workstream[];
  openIssues: OpenIssue[];
  recentLogs: LogEntry[];
  progressLogs: ProgressLogEntry[];
}

// ─── Helpers ─────────────────────────────────────────

function collectTasks(ws: Workstream[]): SubTask[] {
  const tasks: SubTask[] = [];
  for (const w of ws) {
    for (const d of w.deliverables) {
      for (const i of d.initiatives) tasks.push(...i.subTasks);
    }
    for (const i of w.initiatives) tasks.push(...i.subTasks);
  }
  return tasks;
}

function countInitiatives(ws: Workstream[]): number {
  let n = 0;
  for (const w of ws) {
    for (const d of w.deliverables) n += d.initiatives.length;
    n += w.initiatives.length;
  }
  return n;
}

function countDeliverables(ws: Workstream[]): number {
  let n = 0;
  for (const w of ws) n += w.deliverables.length;
  return n;
}

const SEV_COLORS: Record<string, string> = {
  STOPPING: "bg-red-100 text-red-700 border-red-200",
  SLOWING: "bg-amber-100 text-amber-700 border-amber-200",
  NOT_A_CONCERN: "bg-gray-100 text-gray-600 border-gray-200",
};

function sevLabel(s: string) {
  if (s === "STOPPING") return "Stopping";
  if (s === "SLOWING") return "Slowing";
  return "Low";
}

function pctColor(pct: number) {
  if (pct >= 80) return "bg-green-500";
  if (pct >= 50) return "bg-blue-500";
  if (pct >= 20) return "bg-amber-500";
  return "bg-red-500";
}

function statusNorm(s: string): string {
  const n = s.toUpperCase().replace(/[\s_-]+/g, "_");
  if (n.includes("DONE") || n.includes("COMPLETE")) return "DONE";
  if (n.includes("PROGRESS")) return "IN_PROGRESS";
  if (n.includes("BLOCK")) return "BLOCKED";
  return "NOT_STARTED";
}

function cleanTaskName(name: string): string {
  return name.replace(/^PN-\d+\s*[-–—]?\s*/i, "").trim() || name;
}

// ─── Component ───────────────────────────────────────

export function OverviewDashboard({ workstreams, openIssues, recentLogs, progressLogs }: Props) {
  const allTasks = useMemo(() => collectTasks(workstreams), [workstreams]);

  const stats = useMemo(() => {
    const total = allTasks.length;
    const done = allTasks.filter(t => statusNorm(t.status) === "DONE").length;
    const inProgress = allTasks.filter(t => statusNorm(t.status) === "IN_PROGRESS").length;
    const blocked = allTasks.filter(t => statusNorm(t.status) === "BLOCKED").length;
    const notStarted = total - done - inProgress - blocked;
    const totalPoints = allTasks.reduce((s, t) => s + (t.points || 0), 0);

    // Use same formula as Burndown / Task Cards page: task.points * completionPercent / 100
    const donePoints = allTasks.reduce((s, t) => s + Math.round((t.points || 0) * (t.completionPercent || 0) / 100), 0);
    const overallPct = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0;
    const stopping = openIssues.filter(i => i.severity === "STOPPING").length;
    const slowing = openIssues.filter(i => i.severity === "SLOWING").length;
    return { total, done, inProgress, blocked, notStarted, totalPoints, donePoints, overallPct, stopping, slowing };
  }, [allTasks, openIssues]);

  const wsStats = useMemo(() => {
    return workstreams.map(ws => {
      const tasks = collectTasks([ws]);
      const total = tasks.length;
      const done = tasks.filter(t => statusNorm(t.status) === "DONE").length;
      const totalPts = tasks.reduce((s, t) => s + (t.points || 0), 0);
      const donePts = tasks.filter(t => statusNorm(t.status) === "DONE").reduce((s, t) => s + (t.points || 0), 0);
      const pct = totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;
      const issues = openIssues.filter(i => i.workstream.id === ws.id).length;
      return { id: ws.id, name: ws.name, color: ws.color, total, done, totalPts, donePts, pct, issues };
    });
  }, [workstreams, openIssues]);

  const overdueTasks = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return allTasks
      .filter(t => t.endDate && t.endDate < today && statusNorm(t.status) !== "DONE")
      .sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? ""));
  }, [allTasks]);

  const burndownData = useMemo((): BurnPoint[] => {
    if (!progressLogs || progressLogs.length === 0) return [];
    const totalScope = stats.totalPoints;
    if (totalScope <= 0) return [];

    const rangeStart = "2026-01-01";
    const rangeEnd = "2026-12-31";
    const TODAY = new Date().toISOString().slice(0, 10);

    const dated = progressLogs
      .filter(l => l.logDate)
      .sort((a, b) => String(a.logDate!).localeCompare(String(b.logDate!)));

    const allDays: string[] = [];
    const cur = new Date(rangeStart + "T12:00:00Z");
    const end = new Date(rangeEnd + "T12:00:00Z");
    while (cur <= end) {
      allDays.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (allDays.length === 0) return [];

    const byDay = new Map<string, typeof dated>();
    for (const l of dated) {
      const d = new Date(String(l.logDate!)).toISOString().slice(0, 10);
      const arr = byDay.get(d) ?? [];
      arr.push(l);
      byDay.set(d, arr);
    }

    const TARGET_TICKS = 8;
    const tickInterval = Math.max(1, Math.floor(allDays.length / TARGET_TICKS));
    const idealBurnPerDay = totalScope / Math.max(allDays.length - 1, 1);
    let cumBurnt = 0;

    for (const l of dated) {
      const d = new Date(String(l.logDate!)).toISOString().slice(0, 10);
      if (d < rangeStart) cumBurnt += (l.currentPoints ?? 0);
    }

    const points: BurnPoint[] = [];
    let todayIdx = -1;
    for (let i = 0; i < allDays.length; i++) {
      const d = allDays[i];
      const dayLogs = byDay.get(d) ?? [];
      cumBurnt += dayLogs.reduce((s, l) => s + (l.currentPoints ?? 0), 0);

      const showLabel = i === 0 || i === allDays.length - 1 || i % tickInterval === 0;
      const dt = new Date(d + "T12:00:00Z");
      const label = showLabel
        ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
        : "";

      const isToday = d <= TODAY;
      if (isToday) todayIdx = i;

      points.push({
        date: d,
        label,
        idealRemaining: Math.max(0, Math.round(totalScope - idealBurnPerDay * i)),
        actualRemaining: isToday ? Math.max(0, totalScope - cumBurnt) : null,
        projectedRemaining: null,
      });
    }

    if (todayIdx >= 0) {
      const actualAtToday = points[todayIdx].actualRemaining ?? totalScope;
      const elapsedDays = todayIdx + 1;
      const burntSoFar = totalScope - actualAtToday;
      const velocity = elapsedDays > 0 ? burntSoFar / elapsedDays : 0;

      points[todayIdx].projectedRemaining = actualAtToday;

      if (velocity > 0) {
        for (let i = todayIdx + 1; i < points.length; i++) {
          const daysPast = i - todayIdx;
          points[i].projectedRemaining = Math.max(0, Math.round(actualAtToday - velocity * daysPast));
        }
      }
    }

    return points;
  }, [progressLogs, stats.totalPoints]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Project Overview</h1>
        <p className="text-muted-foreground mt-1">High-level summary of the entire project</p>
      </div>

      {/* ── Top-Level Stats Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard label="Workstreams" value={workstreams.length} />
        <StatCard label="Deliverables" value={countDeliverables(workstreams)} />
        <StatCard label="Features" value={countInitiatives(workstreams)} />
        <StatCard label="Tasks" value={stats.total} />
        <StatCard label="Total Points" value={stats.totalPoints} />
        <StatCard label="Open Issues" value={openIssues.length} accent={openIssues.length > 0 ? "text-red-600" : undefined} />
      </div>

      {/* ── Overall Progress ── */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Overall Progress</h2>
          <span className="text-2xl font-bold">{stats.overallPct}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pctColor(stats.overallPct)}`} style={{ width: `${stats.overallPct}%` }} />
        </div>
        <div className="flex gap-6 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Done: {stats.done}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> In Progress: {stats.inProgress}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Blocked: {stats.blocked}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" /> Not Started: {stats.notStarted}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Points Burned: {stats.donePoints} / {stats.totalPoints}</span>
        </div>
      </div>

      {/* ── Overall Burndown Chart ── */}
      <div className="bg-card rounded-lg border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Overall Project Burndown</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{stats.donePoints} / {stats.totalPoints} pts burned</span>
            <Link href="/burndown" className="text-xs text-blue-600 hover:underline">Full burndown</Link>
          </div>
        </div>
        <OverviewBurndownChart data={burndownData} />
      </div>

      {/* ── Workstream Breakdown ── */}
      <div className="bg-card rounded-lg border border-border p-5">
        <h2 className="text-lg font-semibold mb-4">Workstream Breakdown</h2>
        <div className="space-y-3">
          {wsStats.map(ws => (
            <div key={ws.id} className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: ws.color || "#6b7280" }} />
              <span className="text-sm font-medium w-48 truncate" title={ws.name}>{ws.name}</span>
              <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                <div className={`h-full rounded-full ${pctColor(ws.pct)}`} style={{ width: `${ws.pct}%` }} />
              </div>
              <span className="text-xs font-mono w-10 text-right">{ws.pct}%</span>
              <span className="text-xs text-muted-foreground w-20 text-right">{ws.done}/{ws.total} tasks</span>
              {ws.issues > 0 && (
                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">{ws.issues} issues</span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* ── Open Issues Summary ── */}
        <div className="bg-card rounded-lg border border-border p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Open Issues</h2>
            <Link href="/open-issues" className="text-xs text-blue-600 hover:underline">View all</Link>
          </div>
          {openIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open issues</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {openIssues.slice(0, 10).map(issue => (
                <div key={issue.id} className="flex items-start gap-2 text-sm border-b border-border pb-2 last:border-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${SEV_COLORS[issue.severity] || SEV_COLORS.NOT_A_CONCERN}`}>
                    {sevLabel(issue.severity)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{issue.title}</p>
                    <p className="text-xs text-muted-foreground">{issue.workstream.name}</p>
                  </div>
                </div>
              ))}
              {openIssues.length > 10 && (
                <p className="text-xs text-muted-foreground text-center">+ {openIssues.length - 10} more</p>
              )}
            </div>
          )}
        </div>

        {/* ── Recent Activity ── */}
        <div className="bg-card rounded-lg border border-border p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent Activity</h2>
            <Link href="/burndown" className="text-xs text-blue-600 hover:underline">Burndown</Link>
          </div>
          {recentLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No progress updates yet</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {recentLogs.map(log => {
                const displayName = log.subTask?.name || log.initiative?.name || cleanTaskName(log.taskName);
                const wsName = log.workstream?.name;
                return (
                  <div key={log.id} className="text-sm border-b border-border pb-2 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate flex-1 mr-2">{displayName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(log.logDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    {wsName && (
                      <p className="text-[10px] text-muted-foreground">{wsName}</p>
                    )}
                    {log.updateComment && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.updateComment}</p>
                    )}
                    <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
                      {log.completedBy && <span>by {log.completedBy}</span>}
                      {log.percentComplete != null && <span>{log.percentComplete}%</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Overdue Tasks ── */}
      {overdueTasks.length > 0 && (
        <div className="bg-card rounded-lg border border-red-200 p-5">
          <h2 className="text-lg font-semibold text-red-700 mb-3">
            Overdue Tasks ({overdueTasks.length})
          </h2>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {overdueTasks.slice(0, 15).map(t => {
              const days = Math.ceil((Date.now() - new Date(t.endDate!).getTime()) / 86400000);
              return (
                <div key={t.id} className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-red-600 font-medium w-20 shrink-0">{days}d overdue</span>
                  <span className="truncate flex-1">{t.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{t.endDate?.slice(0, 10)}</span>
                  {t.assignee && <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{t.assignee.initials || t.assignee.name}</span>}
                </div>
              );
            })}
            {overdueTasks.length > 15 && (
              <p className="text-xs text-muted-foreground text-center">+ {overdueTasks.length - 15} more</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-card rounded-lg border border-border p-4 text-center">
      <p className={`text-2xl font-bold ${accent || ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

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

      const dt = new Date(d + "T12:00:00Z");
      const isFirst = i === 0;
      const isLast = i === allDays.length - 1;
      const isMonthStart = dt.getUTCDate() === 1;
      const showLabel = isFirst || isLast || isMonthStart;
      const label = showLabel
        ? dt.toLocaleDateString("en-US", { month: "short", ...(isFirst || isLast ? { day: "numeric" } : {}), timeZone: "UTC" })
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

  const overallTrack = useMemo(() => {
    type TrackStatus = "done" | "no-data" | "on-track" | "off-track" | "ahead";
    const remaining = stats.totalPoints - stats.donePoints;
    if (remaining <= 0) return { status: "done" as TrackStatus, velocity: 0, estCompletion: null as string | null, daysOff: 0 };
    const rangeStart = "2026-01-01";
    const rangeEnd = "2026-12-31";
    const today = new Date().toISOString().slice(0, 10);
    const elapsed = Math.round((new Date(today + "T12:00:00Z").getTime() - new Date(rangeStart + "T12:00:00Z").getTime()) / 86400000);
    if (elapsed <= 0) return { status: "no-data" as TrackStatus, velocity: 0, estCompletion: null as string | null, daysOff: 0 };
    const velocity = stats.donePoints / elapsed;
    const totalDays = Math.round((new Date(rangeEnd + "T12:00:00Z").getTime() - new Date(rangeStart + "T12:00:00Z").getTime()) / 86400000);
    const idealBurnPerDay = stats.totalPoints / Math.max(totalDays, 1);
    const idealBurnt = idealBurnPerDay * Math.min(elapsed, totalDays);
    let estCompletion: string | null = null;
    if (velocity > 0) {
      const daysToFinish = Math.ceil(remaining / velocity);
      const est = new Date(today + "T12:00:00Z");
      est.setUTCDate(est.getUTCDate() + daysToFinish);
      estCompletion = est.toISOString().slice(0, 10);
    }
    const daysOff = estCompletion ? Math.round((new Date(estCompletion + "T12:00:00Z").getTime() - new Date(rangeEnd + "T12:00:00Z").getTime()) / 86400000) : 0;
    const status = stats.donePoints >= idealBurnt * 0.95 ? (stats.donePoints > idealBurnt * 1.1 ? "ahead" as const : "on-track" as const) : "off-track" as const;
    return { status, velocity, estCompletion, daysOff };
  }, [stats]);

  const upcomingTasks = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return allTasks
      .filter(t => t.endDate && t.endDate >= today && statusNorm(t.status) !== "DONE")
      .sort((a, b) => (a.endDate ?? "").localeCompare(b.endDate ?? ""))
      .slice(0, 5);
  }, [allTasks]);

  const recentlyCompleted = useMemo(() => {
    return allTasks
      .filter(t => statusNorm(t.status) === "DONE")
      .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))
      .slice(0, 5);
  }, [allTasks]);

  const parseDate = (d: string) => d.includes("T") ? new Date(d) : new Date(d + "T12:00:00Z");
  const fmtShort = (d: string) => parseDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const fmtFull = (d: string) => parseDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Project Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">High-level summary of the entire project</p>
      </div>

      {/* ── Top-Level Stats Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Workstreams" value={workstreams.length} icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Z" /></svg>} />
        <StatCard label="Deliverables" value={countDeliverables(workstreams)} icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>} />
        <StatCard label="Features" value={countInitiatives(workstreams)} icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" /></svg>} />
        <StatCard label="Tasks" value={stats.total} icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>} />
        <StatCard label="Total Points" value={stats.totalPoints} icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75Z" /></svg>} accent="text-blue-600 dark:text-blue-400" />
        <StatCard label="Open Issues" value={openIssues.length} icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126Z" /></svg>} accent={openIssues.length > 0 ? "text-red-500 dark:text-red-400" : undefined} />
      </div>

      {/* ── Overall Progress ── */}
      <div className="bg-card rounded-xl border border-border/60 p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold tracking-tight">Overall Progress</h2>
          <span className="text-3xl font-bold tabular-nums tracking-tight">{stats.overallPct}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-700 ease-out"
            style={{ width: `${stats.overallPct}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5 mt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Done: {stats.done}</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> In Progress: {stats.inProgress}</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Blocked: {stats.blocked}</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 inline-block" /> Not Started: {stats.notStarted}</span>
          <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Points Burned: {stats.donePoints} / {stats.totalPoints}</span>
        </div>
      </div>

      {/* ── Overall Burndown Chart + Recent Updates ── */}
      <div className="flex gap-6">
        <div className="flex-1 min-w-0 bg-card rounded-xl border border-border/60 p-6 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold tracking-tight">Overall Project Burndown</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">{stats.donePoints} / {stats.totalPoints} pts burned</span>
              <Link href="/burndown" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline underline-offset-2">Full burndown →</Link>
            </div>
          </div>

          {/* Track status badge */}
          {overallTrack.status !== "no-data" && (
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 px-3.5 py-2.5 rounded-lg text-[11px] border ${
              overallTrack.status === "off-track" ? "bg-red-50 dark:bg-red-950/20 border-red-200/60 dark:border-red-800/40" :
              overallTrack.status === "ahead" ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-800/40" :
              overallTrack.status === "done" ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/40" :
              "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/40"
            }`}>
              <span className={`font-bold ${
                overallTrack.status === "off-track" ? "text-red-600 dark:text-red-400" :
                overallTrack.status === "ahead" ? "text-blue-700 dark:text-blue-400" :
                "text-emerald-700 dark:text-emerald-400"
              }`}>
                {overallTrack.status === "off-track" ? "Off Track" : overallTrack.status === "ahead" ? "Ahead" : overallTrack.status === "done" ? "Complete" : "On Track"}
              </span>
              {overallTrack.velocity > 0 && (
                <span className="text-muted-foreground tabular-nums">Velocity: {overallTrack.velocity.toFixed(1)} pts/day</span>
              )}
              {overallTrack.estCompletion && overallTrack.status !== "done" && (
                <span className="text-muted-foreground">Projected completion: <span className="font-semibold text-foreground tabular-nums">{fmtFull(overallTrack.estCompletion)}</span></span>
              )}
              {overallTrack.daysOff > 0 && (
                <span className="text-red-600 dark:text-red-400 font-semibold tabular-nums">{overallTrack.daysOff} days late</span>
              )}
              {overallTrack.daysOff < 0 && (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">{Math.abs(overallTrack.daysOff)} days early</span>
              )}
            </div>
          )}

          <OverviewBurndownChart data={burndownData} />
        </div>

        {/* Recent Updates sidebar */}
        {recentLogs.length > 0 && (
          <div className="w-72 shrink-0 hidden lg:block">
            <div className="bg-card rounded-xl border border-border/60 p-5 shadow-card sticky top-4 h-full">
              <h4 className="text-[13px] font-semibold tracking-tight mb-4">Recent Updates</h4>
              <div className="space-y-3.5">
                {recentLogs.slice(0, 5).map(log => {
                  const displayName = log.subTask?.name || log.initiative?.name || cleanTaskName(log.taskName);
                  return (
                    <div key={log.id} className="text-xs border-l-2 border-orange-400/60 pl-3">
                      <span className="font-semibold text-foreground text-[11px] leading-snug block">{displayName}</span>
                      <div className="flex items-center gap-2 text-muted-foreground mt-0.5">
                        <span className="tabular-nums">{new Date(log.logDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        {log.completedBy && <span>by {log.completedBy}</span>}
                      </div>
                      {log.updateComment && (
                        <p className="text-muted-foreground/70 italic mt-1 leading-snug line-clamp-2 text-[10px]">{log.updateComment}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Workstream Breakdown ── */}
      <div className="bg-card rounded-xl border border-border/60 p-6 shadow-card">
        <h2 className="text-base font-semibold tracking-tight mb-5">Workstream Breakdown</h2>
        <div className="space-y-4">
          {wsStats.map(ws => {
            const effortPct = stats.totalPoints > 0 ? Math.round((ws.totalPts / stats.totalPoints) * 100) : 0;
            return (
              <div key={ws.id} className="flex items-center gap-3 group">
                <div className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-card" style={{ backgroundColor: ws.color || "#6b7280" }} />
                <span className="text-[13px] font-medium w-44 truncate" title={ws.name}>{ws.name}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums w-14 text-right shrink-0" title="% of total project effort">{effortPct}% effort</span>
                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${pctColor(ws.pct)}`} style={{ width: `${ws.pct}%` }} />
                </div>
                <span className="text-xs font-semibold tabular-nums w-10 text-right">{ws.pct}%</span>
                <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">{ws.done}/{ws.total} tasks</span>
                {ws.issues > 0 && (
                  <span className="text-[10px] font-medium bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">{ws.issues} issues</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Upcoming & Recently Completed ── */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border border-border/60 p-6 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" /></svg>
            <h2 className="text-base font-semibold tracking-tight">Next 5 Anticipated Releases</h2>
          </div>
          {upcomingTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No upcoming tasks with due dates</p>
          ) : (
            <div className="space-y-0">
              {upcomingTasks.map((t, i) => (
                <div key={t.id} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
                  <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate">{t.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground tabular-nums">Due {fmtShort(t.endDate!)}</span>
                      {t.assignee && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-medium">{t.assignee.initials || t.assignee.name}</span>}
                    </div>
                  </div>
                  <div className="w-12 text-right">
                    <span className="text-[11px] font-semibold tabular-nums text-blue-600 dark:text-blue-400">{t.completionPercent}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border/60 p-6 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
            <h2 className="text-base font-semibold tracking-tight">Recently Completed</h2>
          </div>
          {recentlyCompleted.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No completed tasks yet</p>
          ) : (
            <div className="space-y-0">
              {recentlyCompleted.map(t => (
                <div key={t.id} className="flex items-center gap-3 py-2.5 border-b border-border/40 last:border-0">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate">{t.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {t.endDate && <span className="text-[10px] text-muted-foreground tabular-nums">{fmtShort(t.endDate)}</span>}
                      {t.assignee && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-medium">{t.assignee.initials || t.assignee.name}</span>}
                    </div>
                  </div>
                  <span className="text-[10px] font-medium bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full shrink-0">{t.points} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Open Issues Summary ── */}
      <div className="bg-card rounded-xl border border-border/60 p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold tracking-tight">Open Issues</h2>
          <Link href="/open-issues" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline underline-offset-2">View all →</Link>
        </div>
        {openIssues.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No open issues</p>
        ) : (
          <div className="space-y-0 max-h-80 overflow-y-auto">
            {openIssues.slice(0, 10).map(issue => (
              <div key={issue.id} className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${
                  issue.severity === "STOPPING" ? "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400" :
                  issue.severity === "SLOWING" ? "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400" :
                  "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                }`}>
                  {sevLabel(issue.severity)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] truncate font-medium">{issue.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{issue.workstream.name}</p>
                </div>
              </div>
            ))}
            {openIssues.length > 10 && (
              <p className="text-xs text-muted-foreground text-center pt-2">+ {openIssues.length - 10} more</p>
            )}
          </div>
        )}
      </div>

      {/* ── Overdue Tasks ── */}
      {overdueTasks.length > 0 && (
        <div className="bg-card rounded-xl border border-red-200/60 dark:border-red-900/40 p-6 shadow-card">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded-md bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
              <svg className="w-3 h-3 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
            </div>
            <h2 className="text-base font-semibold tracking-tight text-red-700 dark:text-red-400">
              Overdue Tasks ({overdueTasks.length})
            </h2>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {overdueTasks.slice(0, 15).map(t => {
              const days = Math.ceil((Date.now() - new Date(t.endDate!).getTime()) / 86400000);
              return (
                <div key={t.id} className="flex items-center gap-3 py-1.5 text-[13px]">
                  <span className="text-[11px] font-semibold text-red-500 tabular-nums w-20 shrink-0">{days}d overdue</span>
                  <span className="truncate flex-1">{t.name}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">{t.endDate?.slice(0, 10)}</span>
                  {t.assignee && <span className="text-[11px] bg-muted px-2 py-0.5 rounded-md font-medium">{t.assignee.initials || t.assignee.name}</span>}
                </div>
              );
            })}
            {overdueTasks.length > 15 && (
              <p className="text-xs text-muted-foreground text-center pt-1">+ {overdueTasks.length - 15} more</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────

function StatCard({ label, value, accent, icon }: { label: string; value: number; accent?: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border/60 p-4 shadow-card hover:shadow-card-hover transition-shadow duration-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-muted-foreground/50">{icon}</span>
      </div>
      <p className={`text-2xl font-bold tracking-tight tabular-nums ${accent || ""}`}>{value.toLocaleString()}</p>
      <p className="text-[11px] text-muted-foreground mt-1 font-medium">{label}</p>
    </div>
  );
}

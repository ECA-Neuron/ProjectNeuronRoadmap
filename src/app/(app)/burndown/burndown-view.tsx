"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from "recharts";
import { logProgressUpdate } from "@/lib/actions/log-progress-update";

/* ─── Types ──────────────────────────────────────────── */

interface SubTask {
  id: string; name: string; points: number; completionPercent: number; status: string;
}
interface Initiative {
  id: string; name: string; status: string; totalPoints: number; subTasks: SubTask[];
  startDate: string | null; endDate: string | null;
}
interface Deliverable {
  id: string; name: string; initiatives: Initiative[];
  startDate: string | null; endDate: string | null;
}
interface Workstream {
  id: string; name: string; color: string | null;
  startDate: string | null; endDate: string | null;
  deliverables?: Deliverable[]; initiatives: Initiative[];
}
interface ProgressLogEntry {
  id: string; taskName: string; totalPoints: number; currentPoints: number;
  percentComplete: number; updateComment: string | null; completedBy: string | null;
  logDate: string | null;
  workstreamId: string | null; deliverableId: string | null;
  initiativeId: string | null; subTaskId: string | null;
  subTask?: { name: string } | null;
  initiative?: { name: string } | null;
}

function resolveTaskName(l: ProgressLogEntry): string {
  if (l.subTask?.name) return l.subTask.name;
  if (l.initiative?.name) return l.initiative.name;
  return l.taskName;
}

function allInits(ws: Workstream): Initiative[] {
  return [...(ws.deliverables ?? []).flatMap(d => d.initiatives), ...ws.initiatives];
}

function allSubTasks(ws: Workstream): SubTask[] {
  return allInits(ws).flatMap(i => i.subTasks);
}

function toISO(d: string | null): string | null {
  if (!d) return null;
  try { return new Date(d).toISOString().slice(0, 10); } catch { return null; }
}

const TODAY = new Date().toISOString().slice(0, 10);

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86400000);
}

function fmtDate(d: string): string {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/* ─── Build burndown chart data ──────────────────────── */

interface BurnPoint {
  date: string;
  label: string;
  idealRemaining: number;
  actualRemaining: number | null;
  projectedRemaining: number | null;
  dayLogs: { taskName: string; comment: string | null; by: string | null; pts: number }[];
}

function buildBurndown(
  totalScope: number,
  logs: ProgressLogEntry[],
  rangeStart: string,
  rangeEnd: string,
): BurnPoint[] {
  if (totalScope === 0) return [];

  const dated = logs
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

  const byDay = new Map<string, ProgressLogEntry[]>();
  for (const l of dated) {
    const d = new Date(String(l.logDate!)).toISOString().slice(0, 10);
    const arr = byDay.get(d) ?? [];
    arr.push(l);
    byDay.set(d, arr);
  }

  const TARGET_TICKS = 5;
  const tickInterval = Math.max(1, Math.floor(allDays.length / TARGET_TICKS));
  const idealBurnPerDay = totalScope / Math.max(allDays.length - 1, 1);
  let cumBurnt = 0;

  for (const l of dated) {
    const d = new Date(String(l.logDate!)).toISOString().slice(0, 10);
    if (d < rangeStart) cumBurnt += l.currentPoints;
  }

  // First pass: build actual data up to today to get velocity
  const points: BurnPoint[] = [];
  let todayIdx = -1;
  for (let i = 0; i < allDays.length; i++) {
    const d = allDays[i];
    const dayLogs = byDay.get(d) ?? [];
    cumBurnt += dayLogs.reduce((s, l) => s + l.currentPoints, 0);

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
      dayLogs: dayLogs.filter(l => l.currentPoints > 0 || l.updateComment).map(l => ({
        taskName: resolveTaskName(l), comment: l.updateComment, by: l.completedBy, pts: l.currentPoints,
      })),
    });
  }

  // Compute velocity projection from today onwards
  if (todayIdx >= 0) {
    const actualAtToday = points[todayIdx].actualRemaining ?? totalScope;
    const elapsedDays = todayIdx + 1;
    const burntSoFar = totalScope - actualAtToday;
    const velocity = elapsedDays > 0 ? burntSoFar / elapsedDays : 0;

    // Set projection on today (anchoring point)
    points[todayIdx].projectedRemaining = actualAtToday;

    // Project forward from today
    if (velocity > 0) {
      for (let i = todayIdx + 1; i < points.length; i++) {
        const daysPast = i - todayIdx;
        points[i].projectedRemaining = Math.max(0, Math.round(actualAtToday - velocity * daysPast));
      }
    }
  }

  return points;
}

/* ─── Track status & velocity projection ─────────────── */

interface TrackInfo {
  status: "on-track" | "off-track" | "ahead" | "done" | "no-data";
  velocity: number;
  estCompletion: string | null;
  dueDate: string | null;
  daysOff: number;
  daysAhead: number;
}

function computeTrackInfo(
  totalPts: number,
  burntPts: number,
  startDate: string | null,
  endDate: string | null,
): TrackInfo {
  const sd = toISO(startDate);
  const ed = toISO(endDate);
  const remaining = totalPts - burntPts;

  if (remaining <= 0) return { status: "done", velocity: 0, estCompletion: null, dueDate: ed, daysOff: 0, daysAhead: 0 };
  if (!sd || !ed) return { status: "no-data", velocity: 0, estCompletion: null, dueDate: ed, daysOff: 0, daysAhead: 0 };

  const effectiveStart = sd < TODAY ? sd : TODAY;
  const elapsed = daysBetween(effectiveStart, TODAY);
  if (elapsed <= 0) return { status: "no-data", velocity: 0, estCompletion: null, dueDate: ed, daysOff: 0, daysAhead: 0 };

  const velocity = burntPts / elapsed;
  const totalDays = daysBetween(sd, ed);
  const idealBurnPerDay = totalPts / Math.max(totalDays, 1);
  const elapsedFromStart = daysBetween(sd, TODAY);
  const idealBurnt = idealBurnPerDay * Math.min(elapsedFromStart, totalDays);

  let estCompletion: string | null = null;
  if (velocity > 0) {
    const daysToFinish = Math.ceil(remaining / velocity);
    const est = new Date(TODAY + "T12:00:00Z");
    est.setUTCDate(est.getUTCDate() + daysToFinish);
    estCompletion = est.toISOString().slice(0, 10);
  }

  const daysOff = estCompletion ? daysBetween(ed, estCompletion) : 0;
  const diff = burntPts - idealBurnt;
  const daysAhead = velocity > 0 ? Math.round(diff / velocity) : 0;

  let status: TrackInfo["status"];
  if (burntPts >= idealBurnt * 0.95) {
    status = burntPts > idealBurnt * 1.1 ? "ahead" : "on-track";
  } else {
    status = "off-track";
  }

  return { status, velocity, estCompletion, dueDate: ed, daysOff, daysAhead };
}

const TRACK_STYLES: Record<TrackInfo["status"], { bg: string; text: string; label: string }> = {
  "on-track": { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", label: "On Track" },
  "ahead":    { bg: "bg-blue-100 dark:bg-blue-900/30",  text: "text-blue-700 dark:text-blue-400",  label: "Ahead" },
  "off-track":{ bg: "bg-red-100 dark:bg-red-900/30",    text: "text-red-700 dark:text-red-400",    label: "Off Track" },
  "done":     { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", label: "Complete" },
  "no-data":  { bg: "bg-gray-100 dark:bg-gray-800",     text: "text-gray-500",                      label: "No Data" },
};

/* ─── Custom dot for progress update highlights ──────── */

function ActualDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null) return null;
  const hasLogs = payload?.dayLogs && payload.dayLogs.length > 0;
  if (hasLogs) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={5} fill="#10b981" stroke="#fff" strokeWidth={2} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={1.5} fill="#f97316" stroke="none" />;
}

/* ─── Tooltip ────────────────────────────────────────── */

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload as BurnPoint | undefined;
  if (!pt) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[320px] text-xs z-50">
      <p className="font-semibold text-sm mb-1">
        {pt.date ? fmtDate(pt.date) : ""}
      </p>
      <div className="flex gap-4 mb-1">
        <span className="text-blue-600">Ideal: {pt.idealRemaining.toFixed(0)} pts</span>
        {pt.actualRemaining !== null && <span className="text-orange-600">Actual: {pt.actualRemaining.toFixed(0)} pts</span>}
        {pt.projectedRemaining !== null && pt.actualRemaining === null && <span className="text-orange-400">Projected: {pt.projectedRemaining.toFixed(0)} pts</span>}
      </div>
      {pt.dayLogs.length > 0 && (
        <div className="border-t pt-1.5 mt-1 space-y-1 max-h-[200px] overflow-y-auto">
          {pt.dayLogs.map((l, i) => (
            <div key={i} className="text-muted-foreground">
              <span className="font-medium text-foreground">{l.taskName}</span>
              {l.pts > 0 && <span className="text-green-600 ml-1">+{l.pts.toFixed(1)} pts</span>}
              {l.by && <span className="ml-1">by {l.by}</span>}
              {l.comment && <p className="text-[10px] mt-0.5 italic leading-tight line-clamp-2">{l.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Chart component ────────────────────────────────── */

function BurndownChart({ title, subtitle, data, totalPts, burntPts, noDate, onClick, extra, track }: {
  title: string; subtitle?: string; data: BurnPoint[];
  totalPts: number; burntPts: number; noDate?: boolean;
  onClick?: () => void; extra?: React.ReactNode;
  track?: TrackInfo;
}) {
  const pct = totalPts > 0 ? Math.round((burntPts / totalPts) * 100) : 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) setChartWidth(containerRef.current.offsetWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const style = track ? TRACK_STYLES[track.status] : null;

  return (
    <div
      className={`rounded-lg border border-border p-5 min-w-0 overflow-hidden ${onClick ? "cursor-pointer hover:border-blue-400 hover:shadow-md transition-all" : ""}`}
      onClick={onClick}
    >
      <div className="mb-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold text-base">{title}</h3>
          <div className="text-right shrink-0">
            <span className="text-2xl font-bold text-blue-600">{pct}%</span>
            <p className="text-xs text-muted-foreground">{burntPts.toFixed(0)} / {totalPts.toFixed(0)} pts</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {onClick && <span className="text-xs text-blue-500">Click to drill in →</span>}
        </div>
      </div>

      {/* Track status badge + velocity info */}
      {style && track && track.status !== "no-data" && (
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 px-3 py-2 rounded-md text-xs ${style.bg}`}>
          <span className={`font-bold ${style.text}`}>{style.label}</span>
          {track.dueDate && (
            <span className="text-muted-foreground">
              Due: <span className="font-semibold text-foreground">{fmtDate(track.dueDate)}</span>
            </span>
          )}
          {track.velocity > 0 && (
            <span className="text-muted-foreground">
              Velocity: {track.velocity.toFixed(1)} pts/day
            </span>
          )}
          {track.estCompletion && track.status !== "done" && (
            <span className="text-muted-foreground">
              Projected completion: <span className="font-semibold text-foreground">{fmtDate(track.estCompletion)}</span>
            </span>
          )}
          {track.status === "off-track" && track.daysOff > 0 && (
            <span className="text-red-600 font-semibold">
              {track.daysOff} days late
            </span>
          )}
          {track.status === "ahead" && track.daysOff < 0 && (
            <span className="text-blue-600 font-semibold">
              {Math.abs(track.daysOff)} days early
            </span>
          )}
          {track.status === "on-track" && track.daysOff > 0 && (
            <span className="text-orange-600 font-semibold">
              {track.daysOff} days late
            </span>
          )}
          {track.status === "on-track" && track.daysOff < 0 && (
            <span className="text-green-600 font-semibold">
              {Math.abs(track.daysOff)} days early
            </span>
          )}
        </div>
      )}

      <div className="w-full h-2 bg-gray-200 rounded-full mb-4">
        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>

      {noDate ? (
        <div className="py-12 text-center text-muted-foreground text-sm">No date set in Notion for this item.</div>
      ) : (
        <div ref={containerRef}>
          {data.length > 0 && chartWidth > 0 ? (
            <LineChart width={chartWidth} height={300} data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                fontSize={9}
                interval={0}
                height={45}
                tick={({ x, y, payload }: any) =>
                  payload.value
                    ? <text x={x} y={y + 10} textAnchor="end" fontSize={9} fill="#666" transform={`rotate(-35, ${x}, ${y + 10})`}>{payload.value}</text>
                    : <g />
                }
              />
              <YAxis fontSize={10} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line type="linear" dataKey="idealRemaining" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#3b82f6" }} name="Ideal Remaining" />
              <Line type="monotone" dataKey="actualRemaining" stroke="#f97316" strokeWidth={2} dot={<ActualDot />} activeDot={{ r: 6, fill: "#10b981", stroke: "#fff", strokeWidth: 2 }} name="Actual Remaining" connectNulls={false} />
              <Line type="linear" dataKey="projectedRemaining" stroke="#f97316" strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={{ r: 3, fill: "#fb923c" }} name="Projected (velocity)" connectNulls={false} />
            </LineChart>
          ) : data.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">No progress log entries in this range.</div>
          ) : null}
        </div>
      )}

      {extra}
    </div>
  );
}

/* ─── Date helpers ───────────────────────────────────── */

const MONTH_OPTIONS: { value: string; label: string }[] = [];
for (let y = 2025; y <= 2030; y++) {
  for (let m = 1; m <= 12; m++) {
    const val = `${y}-${String(m).padStart(2, "0")}`;
    const label = new Date(y, m - 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    MONTH_OPTIONS.push({ value: val, label });
  }
}

function fmtDateRange(s: string | null, e: string | null): string {
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (s && e) return `${fmt(s)} → ${fmt(e)}`;
  if (s) return `From ${fmt(s)}`;
  if (e) return `Until ${fmt(e)}`;
  return "";
}

/* ─── Shared chart-data builder ──────────────────────── */

interface ChartItem {
  id: string; name: string; totalPts: number; burntPts: number;
  data: BurnPoint[]; hasDate: boolean; dateLabel: string;
  startDate: string | null; endDate: string | null;
  track: TrackInfo;
}

function buildItemChart(
  id: string,
  tasks: SubTask[],
  logs: ProgressLogEntry[],
  name: string,
  startDate: string | null,
  endDate: string | null,
): ChartItem | null {
  const total = tasks.reduce((s, t) => s + t.points, 0);
  if (total === 0) return null;
  const burnt = tasks.reduce((s, t) => s + Math.round(t.points * t.completionPercent / 100), 0);
  const sd = toISO(startDate);
  const ed = toISO(endDate);
  const hasDate = !!(sd && ed);
  const data = hasDate ? buildBurndown(total, logs, sd!, ed!) : [];
  const track = computeTrackInfo(total, burnt, startDate, endDate);
  return { id, name, totalPts: total, burntPts: burnt, data, hasDate, dateLabel: fmtDateRange(startDate, endDate), startDate, endDate, track };
}

function buildTaskChart(
  task: SubTask,
  logs: ProgressLogEntry[],
  parentStart: string | null,
  parentEnd: string | null,
): ChartItem | null {
  if (task.points === 0) return null;
  const taskLogs = logs.filter(l => l.subTaskId === task.id);
  const sd = toISO(parentStart);
  const ed = toISO(parentEnd);
  const hasDate = !!(sd && ed);
  const data = hasDate ? buildBurndown(task.points, taskLogs, sd!, ed!) : [];
  const burnt = Math.round(task.points * task.completionPercent / 100);
  const track = computeTrackInfo(task.points, burnt, parentStart, parentEnd);
  return { id: task.id, name: task.name, totalPts: task.points, burntPts: burnt, data, hasDate, dateLabel: fmtDateRange(parentStart, parentEnd), startDate: parentStart, endDate: parentEnd, track };
}

/* ─── Dropdown select ────────────────────────────────── */

function LevelSelect({ label, value, onChange, options, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return (
    <div className="flex-1 min-w-[160px]">
      <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-9 text-sm border rounded-md px-2 bg-background disabled:opacity-40 disabled:cursor-not-allowed truncate"
      >
        <option value="__all__">All {label}s</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────── */

export default function BurndownView({ workstreams, progressLogs }: {
  workstreams: Workstream[]; progressLogs: ProgressLogEntry[];
}) {
  const router = useRouter();

  const [rangeStart, setRangeStart] = useState("2026-01");
  const [rangeEnd, setRangeEnd] = useState("2026-12");

  const [selWs, setSelWs] = useState("__all__");
  const [selDel, setSelDel] = useState("__all__");
  const [selInit, setSelInit] = useState("__all__");
  const [selTask, setSelTask] = useState("__all__");

  const handleWsChange = useCallback((v: string) => { setSelWs(v); setSelDel("__all__"); setSelInit("__all__"); setSelTask("__all__"); }, []);
  const handleDelChange = useCallback((v: string) => { setSelDel(v); setSelInit("__all__"); setSelTask("__all__"); }, []);
  const handleInitChange = useCallback((v: string) => { setSelInit(v); setSelTask("__all__"); }, []);

  const clickWs = useCallback((id: string) => { setSelWs(id); setSelDel("__all__"); setSelInit("__all__"); setSelTask("__all__"); }, []);
  const clickDel = useCallback((id: string) => { setSelDel(id); setSelInit("__all__"); setSelTask("__all__"); }, []);
  const clickInit = useCallback((id: string) => { setSelInit(id); setSelTask("__all__"); }, []);
  const clickTask = useCallback((id: string) => { setSelTask(id); }, []);

  const { totalPts, burntPts } = useMemo(() => {
    let total = 0, burnt = 0;
    for (const ws of workstreams) {
      for (const st of allSubTasks(ws)) {
        total += st.points;
        burnt += Math.round(st.points * st.completionPercent / 100);
      }
    }
    return { totalPts: total, burntPts: burnt };
  }, [workstreams]);

  const overallStart = rangeStart + "-01";
  const overallEndD = new Date(rangeEnd + "-01T12:00:00Z");
  overallEndD.setUTCMonth(overallEndD.getUTCMonth() + 1);
  overallEndD.setUTCDate(0);
  const overallEnd = overallEndD.toISOString().slice(0, 10);
  const overallChart = useMemo(() => buildBurndown(totalPts, progressLogs, overallStart, overallEnd), [totalPts, progressLogs, overallStart, overallEnd]);
  const overallTrack = useMemo(() => computeTrackInfo(totalPts, burntPts, overallStart, overallEnd), [totalPts, burntPts, overallStart, overallEnd]);

  /* ── Dropdown options ── */

  const wsOptions = useMemo(() =>
    workstreams.filter(ws => allSubTasks(ws).length > 0).map(ws => ({ value: ws.id, label: ws.name })),
    [workstreams]);

  const activeWs = useMemo(() => selWs !== "__all__" ? workstreams.find(ws => ws.id === selWs) : undefined, [selWs, workstreams]);

  const delOptions = useMemo(() => {
    if (!activeWs) return [];
    return (activeWs.deliverables ?? [])
      .filter(d => d.initiatives.flatMap(i => i.subTasks).length > 0)
      .map(d => ({ value: d.id, label: d.name }));
  }, [activeWs]);

  const activeDel = useMemo(() => selDel !== "__all__" ? (activeWs?.deliverables ?? []).find(d => d.id === selDel) : undefined, [selDel, activeWs]);

  const initOptions = useMemo(() => {
    if (activeDel) return activeDel.initiatives.filter(i => i.subTasks.length > 0).map(i => ({ value: i.id, label: i.name }));
    if (activeWs) return allInits(activeWs).filter(i => i.subTasks.length > 0).map(i => ({ value: i.id, label: i.name }));
    return [];
  }, [activeDel, activeWs]);

  const activeInit = useMemo(() => {
    if (selInit === "__all__") return undefined;
    if (activeDel) return activeDel.initiatives.find(i => i.id === selInit);
    if (activeWs) return allInits(activeWs).find(i => i.id === selInit);
    return undefined;
  }, [selInit, activeDel, activeWs]);

  const taskOptions = useMemo(() => {
    if (activeInit) return activeInit.subTasks.filter(t => t.points > 0).map(t => ({ value: t.id, label: t.name }));
    return [];
  }, [activeInit]);

  const activeTask = useMemo(() => selTask !== "__all__" ? activeInit?.subTasks.find(t => t.id === selTask) : undefined, [selTask, activeInit]);

  /* ── Primary drill-down chart ── */

  const drillDown = useMemo((): ChartItem | null => {
    if (selWs === "__all__") return null;

    if (activeTask && activeInit) {
      return buildTaskChart(activeTask, progressLogs, activeInit.startDate, activeInit.endDate);
    }
    if (activeInit && selTask === "__all__") {
      const logs = progressLogs.filter(l => l.initiativeId === activeInit.id);
      return buildItemChart(activeInit.id, activeInit.subTasks, logs, activeInit.name, activeInit.startDate, activeInit.endDate);
    }
    if (activeDel && selInit === "__all__") {
      const tasks = activeDel.initiatives.flatMap(i => i.subTasks);
      const logs = progressLogs.filter(l => l.deliverableId === activeDel.id);
      return buildItemChart(activeDel.id, tasks, logs, activeDel.name, activeDel.startDate, activeDel.endDate);
    }
    if (activeWs && selDel === "__all__") {
      const tasks = allSubTasks(activeWs);
      const logs = progressLogs.filter(l => l.workstreamId === activeWs.id);
      return buildItemChart(activeWs.id, tasks, logs, activeWs.name, activeWs.startDate, activeWs.endDate);
    }
    return null;
  }, [activeWs, activeDel, activeInit, activeTask, selWs, selDel, selInit, selTask, progressLogs]);

  /* ── Child charts ── */
  const allWsCharts = useMemo(() => {
    if (selWs !== "__all__") return null;
    return workstreams
      .map(ws => {
        const tasks = allSubTasks(ws);
        const logs = progressLogs.filter(l => l.workstreamId === ws.id);
        return buildItemChart(ws.id, tasks, logs, ws.name, ws.startDate, ws.endDate);
      })
      .filter(Boolean) as ChartItem[];
  }, [selWs, workstreams, progressLogs]);

  const deliverableCharts = useMemo(() => {
    if (!activeWs || selDel !== "__all__") return null;
    return (activeWs.deliverables ?? [])
      .map(del => {
        const tasks = del.initiatives.flatMap(i => i.subTasks);
        const logs = progressLogs.filter(l => l.deliverableId === del.id);
        return buildItemChart(del.id, tasks, logs, del.name, del.startDate, del.endDate);
      })
      .filter(Boolean) as ChartItem[];
  }, [activeWs, selDel, progressLogs]);

  const featureCharts = useMemo(() => {
    if (!activeDel || selInit !== "__all__") return null;
    return activeDel.initiatives
      .map(init => {
        const logs = progressLogs.filter(l => l.initiativeId === init.id);
        return buildItemChart(init.id, init.subTasks, logs, init.name, init.startDate, init.endDate);
      })
      .filter(Boolean) as ChartItem[];
  }, [activeDel, selInit, progressLogs]);

  const taskCharts = useMemo(() => {
    if (!activeInit || selTask !== "__all__") return null;
    return activeInit.subTasks
      .map(t => buildTaskChart(t, progressLogs, activeInit.startDate, activeInit.endDate))
      .filter(Boolean) as ChartItem[];
  }, [activeInit, selTask, progressLogs]);

  const activeTaskLogs = useMemo(() => {
    if (!activeTask) return [];
    return progressLogs
      .filter(l => l.subTaskId === activeTask.id)
      .sort((a, b) => String(b.logDate ?? "").localeCompare(String(a.logDate ?? "")));
  }, [activeTask, progressLogs]);

  return (
    <div className="space-y-8">
      {/* Header + overall date range */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">Burndown</h1>
          <p className="text-muted-foreground mt-1">
            {totalPts} total points across {workstreams.reduce((s, ws) => s + allSubTasks(ws).length, 0)} tasks
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="font-medium text-muted-foreground">Overall Range:</label>
          <select value={rangeStart} onChange={e => setRangeStart(e.target.value)} className="h-7 text-xs border rounded px-1.5 bg-background">
            {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="text-muted-foreground">to</span>
          <select value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} className="h-7 text-xs border rounded px-1.5 bg-background">
            {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Points" value={totalPts} />
        <SummaryCard label="Completed" value={burntPts} color="text-green-600" />
        <SummaryCard label="Remaining" value={totalPts - burntPts} color="text-orange-500" />
        <SummaryCard label="Progress" value={`${totalPts > 0 ? Math.round(burntPts / totalPts * 100) : 0}%`} color="text-blue-600" pct={totalPts > 0 ? burntPts / totalPts * 100 : 0} />
      </div>

      {/* Overall burndown */}
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <BurndownChart
            title="Overall Project Burndown"
            subtitle={`${progressLogs.length} progress updates`}
            data={overallChart}
            totalPts={totalPts}
            burntPts={burntPts}
            track={overallTrack}
          />
        </div>
        <OverallRecentUpdates logs={progressLogs} />
      </div>

      {/* ── Drill-Down Section ── */}
      <div className="space-y-5">
        <h2 className="text-xl font-bold">Drill Down</h2>

        <div className="flex flex-wrap gap-3">
          <LevelSelect label="Workstream" value={selWs} onChange={handleWsChange} options={wsOptions} />
          <LevelSelect label="Deliverable" value={selDel} onChange={handleDelChange} options={delOptions} disabled={selWs === "__all__"} />
          <LevelSelect label="Feature" value={selInit} onChange={handleInitChange} options={initOptions} disabled={selDel === "__all__" && selWs === "__all__"} />
          <LevelSelect label="Task" value={selTask} onChange={v => setSelTask(v)} options={taskOptions} disabled={selInit === "__all__"} />
        </div>

        {/* All Workstreams grid */}
        {selWs === "__all__" && allWsCharts && allWsCharts.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {allWsCharts.map(c => (
              <BurndownChart key={c.id} title={c.name} subtitle={c.hasDate ? c.dateLabel : undefined} data={c.data} totalPts={c.totalPts} burntPts={c.burntPts} noDate={!c.hasDate} onClick={() => clickWs(c.id)} track={c.track} />
            ))}
          </div>
        )}

        {/* Primary chart for selected level */}
        {drillDown && (
          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <BurndownChart
                title={drillDown.name}
                subtitle={drillDown.hasDate ? drillDown.dateLabel : undefined}
                data={drillDown.data}
                totalPts={drillDown.totalPts}
                burntPts={drillDown.burntPts}
                noDate={!drillDown.hasDate}
                track={drillDown.track}
                extra={activeTask ? (
                  <div className="mt-4 space-y-4">
                    <LogUpdateForm subTask={activeTask} onSaved={() => router.refresh()} />
                    {activeTaskLogs.length > 0 && (
                      <div className="border-t pt-3 space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Progress Log ({activeTaskLogs.length} entries)</p>
                        <div className="max-h-[200px] overflow-y-auto space-y-1.5">
                          {activeTaskLogs.map(l => (
                            <div key={l.id} className="text-xs border-l-2 border-blue-300 pl-2">
                              <span className="font-medium">
                                {l.logDate ? new Date(l.logDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date"}
                              </span>
                              <span className="text-green-600 ml-2">+{l.currentPoints} pts</span>
                              {l.completedBy && <span className="text-muted-foreground ml-1">by {l.completedBy}</span>}
                              {l.updateComment && <p className="text-muted-foreground italic mt-0.5 line-clamp-2">{l.updateComment}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : undefined}
              />
            </div>
            <RecentUpdates logs={progressLogs} filterId={drillDown.id} level={activeTask ? "task" : activeInit ? "initiative" : activeDel ? "deliverable" : "workstream"} />
          </div>
        )}

        {/* Workstream → Deliverable children */}
        {activeWs && selDel === "__all__" && deliverableCharts && deliverableCharts.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Deliverables in {activeWs.name}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {deliverableCharts.map(c => (
                <BurndownChart key={c.id} title={c.name} subtitle={c.hasDate ? c.dateLabel : undefined} data={c.data} totalPts={c.totalPts} burntPts={c.burntPts} noDate={!c.hasDate} onClick={() => clickDel(c.id)} track={c.track} />
              ))}
            </div>
          </div>
        )}

        {/* Deliverable → Feature children */}
        {activeDel && selInit === "__all__" && featureCharts && featureCharts.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Features in {activeDel.name}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {featureCharts.map(c => (
                <BurndownChart key={c.id} title={c.name} subtitle={c.hasDate ? c.dateLabel : undefined} data={c.data} totalPts={c.totalPts} burntPts={c.burntPts} noDate={!c.hasDate} onClick={() => clickInit(c.id)} track={c.track} />
              ))}
            </div>
          </div>
        )}

        {/* Feature → Task children */}
        {activeInit && selTask === "__all__" && taskCharts && taskCharts.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Tasks in {activeInit.name}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {taskCharts.map(c => {
                const st = activeInit.subTasks.find(t => t.id === c.id);
                return (
                  <BurndownChart
                    key={c.id} title={c.name} subtitle={c.hasDate ? c.dateLabel : undefined}
                    data={c.data} totalPts={c.totalPts} burntPts={c.burntPts} noDate={!c.hasDate}
                    onClick={() => clickTask(c.id)} track={c.track}
                    extra={st ? <LogUpdateForm subTask={st} onSaved={() => router.refresh()} compact /> : undefined}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Overall Recent Updates sidebar ─────────────────── */

function OverallRecentUpdates({ logs }: { logs: ProgressLogEntry[] }) {
  const recent = useMemo(() =>
    [...logs]
      .sort((a, b) => String(b.logDate ?? "").localeCompare(String(a.logDate ?? "")))
      .slice(0, 5),
    [logs]);

  if (recent.length === 0) return null;

  return (
    <div className="w-72 shrink-0 hidden lg:block">
      <div className="rounded-lg border border-border p-4 sticky top-4">
        <h4 className="text-sm font-semibold mb-3">Recent Updates</h4>
        <div className="space-y-3">
          {recent.map(l => (
            <div key={l.id} className="text-xs border-l-2 border-orange-300 pl-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-semibold text-foreground">{resolveTaskName(l)}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>{l.logDate ? new Date(l.logDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No date"}</span>
                <span className="text-green-600 font-medium">+{l.currentPoints} pts</span>
                {l.completedBy && <span>by {l.completedBy}</span>}
              </div>
              {l.updateComment && (
                <p className="text-muted-foreground italic mt-0.5 leading-snug line-clamp-2">{l.updateComment}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Recent Updates sidebar ─────────────────────────── */

function RecentUpdates({ logs, filterId, level }: {
  logs: ProgressLogEntry[];
  filterId: string;
  level: "workstream" | "deliverable" | "initiative" | "task";
}) {
  const recent = useMemo(() => {
    let filtered: ProgressLogEntry[];
    switch (level) {
      case "workstream": filtered = logs.filter(l => l.workstreamId === filterId); break;
      case "deliverable": filtered = logs.filter(l => l.deliverableId === filterId); break;
      case "initiative": filtered = logs.filter(l => l.initiativeId === filterId); break;
      case "task": filtered = logs.filter(l => l.subTaskId === filterId); break;
    }
    return filtered
      .sort((a, b) => String(b.logDate ?? "").localeCompare(String(a.logDate ?? "")))
      .slice(0, 5);
  }, [logs, filterId, level]);

  if (recent.length === 0) return null;

  return (
    <div className="w-72 shrink-0 hidden lg:block">
      <div className="rounded-lg border border-border p-4 sticky top-4">
        <h4 className="text-sm font-semibold mb-3">Recent Updates</h4>
        <div className="space-y-3">
          {recent.map(l => (
            <div key={l.id} className="text-xs border-l-2 border-orange-300 pl-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-semibold text-foreground">{resolveTaskName(l)}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>{l.logDate ? new Date(l.logDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No date"}</span>
                <span className="text-green-600 font-medium">+{l.currentPoints} pts</span>
                {l.completedBy && <span>by {l.completedBy}</span>}
              </div>
              {l.updateComment && (
                <p className="text-muted-foreground italic mt-0.5 leading-snug line-clamp-2">{l.updateComment}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Summary Card ───────────────────────────────────── */

function SummaryCard({ label, value, color, pct }: {
  label: string; value: number | string; color?: string; pct?: number;
}) {
  return (
    <div className="rounded-lg border border-border p-5 text-center">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color ?? ""}`}>{typeof value === "number" ? value.toLocaleString() : value}</p>
      {pct !== undefined && (
        <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
          <div className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-green-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/* ─── Log Update Form ────────────────────────────────── */

function LogUpdateForm({ subTask, onSaved, compact }: { subTask: SubTask; onSaved: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [currentPts, setCurrentPts] = useState(String(Math.round(subTask.points * subTask.completionPercent / 100)));
  const [totalPts, setTotalPts] = useState(String(subTask.points));
  const [pct, setPct] = useState(String(subTask.completionPercent));
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setFlash(null);
    try {
      await logProgressUpdate({
        subTaskId: subTask.id,
        currentPoints: parseFloat(currentPts) || 0,
        totalPoints: parseFloat(totalPts) || 0,
        percentComplete: parseFloat(pct) || 0,
        comment,
      });
      setFlash("Update logged and pushed to Notion");
      setComment("");
      setOpen(false);
      onSaved();
    } catch (err) {
      setFlash(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
      setTimeout(() => setFlash(null), 4000);
    }
  }, [subTask.id, currentPts, totalPts, pct, comment, saving, onSaved]);

  if (!open) {
    return (
      <div className={compact ? "mt-2" : "mt-3 border-t pt-3"}>
        {flash && <p className="text-[10px] text-green-600 mb-1">{flash}</p>}
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}
          className="text-[11px] text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Log Update
        </button>
      </div>
    );
  }

  return (
    <div className={`${compact ? "mt-2" : "mt-3 border-t pt-3"} space-y-2`} onClick={e => e.stopPropagation()}>
      <p className="text-[11px] font-semibold text-muted-foreground">Log Progress Update</p>
      {flash && <p className="text-[10px] text-green-600">{flash}</p>}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[9px] text-muted-foreground mb-0.5">Current Pts</label>
          <input type="number" min={0} value={currentPts} onChange={e => setCurrentPts(e.target.value)} className="w-full h-6 text-[11px] border rounded px-1.5 bg-background" />
        </div>
        <div>
          <label className="block text-[9px] text-muted-foreground mb-0.5">Total Pts</label>
          <input type="number" min={0} value={totalPts} onChange={e => setTotalPts(e.target.value)} className="w-full h-6 text-[11px] border rounded px-1.5 bg-background" />
        </div>
        <div>
          <label className="block text-[9px] text-muted-foreground mb-0.5">% Complete</label>
          <input type="number" min={0} max={100} value={pct} onChange={e => setPct(e.target.value)} className="w-full h-6 text-[11px] border rounded px-1.5 bg-background" />
        </div>
      </div>
      <div>
        <label className="block text-[9px] text-muted-foreground mb-0.5">Comment</label>
        <input
          type="text"
          value={comment}
          onChange={e => setComment(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
          placeholder="What changed?"
          className="w-full h-6 text-[11px] border rounded px-1.5 bg-background"
        />
      </div>
      <div className="flex items-center gap-2">
        <button onClick={handleSave} disabled={saving} className="text-[10px] font-medium px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
          {saving ? "Saving…" : "Save & Push to Notion"}
        </button>
        <button onClick={() => setOpen(false)} disabled={saving} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

// ─── Types ────────────────────────────────────────────

interface ProgressLogEntry {
  id: string;
  taskName: string;
  percentComplete: number;
  totalPoints: number;
  currentPoints: number;
  addedPoints: number;
  scopeStatus: string | null;
  logDate: string | null;
  completedBy: string | null;
  updateComment: string | null;
  subTaskId: string | null;
  initiativeId: string | null;
  deliverableId: string | null;
  workstreamId: string | null;
}

interface SubTaskRow { id: string; name: string; }
interface InitiativeRow { id: string; name: string; subTasks: SubTaskRow[]; }
interface DeliverableRow { id: string; name: string; initiatives: InitiativeRow[]; }
interface WorkstreamRow { id: string; name: string; deliverables: DeliverableRow[]; initiatives: InitiativeRow[]; }

type DrillLevel = "overview" | "workstream" | "deliverable" | "feature";

interface Breadcrumb { level: DrillLevel; id?: string; label: string; }

interface BurnPoint {
  date: string;
  dateLabel: string;
  idealRemaining: number;
  actualRemaining: number;
  logs: { taskName: string; comment: string | null; completedBy: string | null; pointsBurnt: number }[];
}

// ─── Build burndown data ──────────────────────────────

function buildBurndown(logs: ProgressLogEntry[]): BurnPoint[] {
  if (logs.length === 0) return [];

  const dated = logs.filter((l) => l.logDate).sort((a, b) => a.logDate!.localeCompare(b.logDate!));
  if (dated.length === 0) return [];

  const totalScope = dated.reduce((sum, l) => sum + l.totalPoints, 0);
  const uniqueLogCount = dated.length;
  if (totalScope === 0) return [];

  const byDate = new Map<string, ProgressLogEntry[]>();
  for (const l of dated) {
    const d = l.logDate!.slice(0, 10);
    const arr = byDate.get(d) ?? [];
    arr.push(l);
    byDate.set(d, arr);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];

  const allDates: string[] = [];
  const cur = new Date(startDate);
  const end = new Date(endDate);
  while (cur <= end) {
    allDates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  const totalDays = allDates.length;
  const idealDailyBurn = totalScope / Math.max(totalDays - 1, 1);

  let cumulativeBurnt = 0;
  const points: BurnPoint[] = [];

  for (let i = 0; i < allDates.length; i++) {
    const d = allDates[i];
    const dayLogs = byDate.get(d) ?? [];
    const dayBurnt = dayLogs.reduce((s, l) => s + l.currentPoints, 0);
    cumulativeBurnt += dayBurnt;

    const logDetails = dayLogs
      .filter((l) => l.currentPoints > 0 || l.updateComment)
      .map((l) => ({
        taskName: l.taskName,
        comment: l.updateComment,
        completedBy: l.completedBy,
        pointsBurnt: l.currentPoints,
      }));

    points.push({
      date: d,
      dateLabel: new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      idealRemaining: Math.max(0, totalScope - idealDailyBurn * i),
      actualRemaining: Math.max(0, totalScope - cumulativeBurnt),
      logs: logDetails,
    });
  }

  return points;
}

// ─── Custom Tooltip ───────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as BurnPoint | undefined;
  if (!point) return null;

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 max-w-[280px] text-xs">
      <p className="font-semibold text-sm mb-1">{point.dateLabel}</p>
      <div className="flex gap-4 mb-1">
        <span className="text-blue-600">Ideal: {point.idealRemaining.toFixed(0)} pts</span>
        <span className="text-orange-600">Actual: {point.actualRemaining.toFixed(0)} pts</span>
      </div>
      {point.logs.length > 0 && (
        <div className="border-t pt-1.5 mt-1 space-y-1">
          {point.logs.map((l, i) => (
            <div key={i} className="text-muted-foreground">
              <span className="font-medium text-foreground">{l.taskName}</span>
              {l.pointsBurnt > 0 && <span className="text-green-600 ml-1">+{l.pointsBurnt.toFixed(0)} pts</span>}
              {l.completedBy && <span className="ml-1">by {l.completedBy}</span>}
              {l.comment && <p className="text-[10px] mt-0.5 italic">{l.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Active dot ───────────────────────────────────────

function ActiveDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload?.logs?.length) return null;
  return <circle cx={cx} cy={cy} r={5} fill="#f97316" stroke="#fff" strokeWidth={2} />;
}

// ─── Chart ────────────────────────────────────────────

function BurndownChart({ title, data, subtitle }: { title: string; data: BurnPoint[]; subtitle?: string }) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border p-4 text-center text-muted-foreground">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs mt-1">No progress data yet.</p>
      </div>
    );
  }

  const start = data[0];
  const latest = data[data.length - 1];
  const totalPts = start.idealRemaining;
  const burnt = totalPts - latest.actualRemaining;
  const pct = totalPts > 0 ? Math.round((burnt / totalPts) * 100) : 0;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-xs truncate">{title}</h3>
          {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="text-right shrink-0">
          <span className="text-lg font-bold text-blue-600">{pct}%</span>
          <p className="text-[10px] text-muted-foreground">{burnt.toFixed(0)} / {totalPts.toFixed(0)} pts</p>
        </div>
      </div>

      <div className="w-full h-1 bg-gray-200 rounded-full mb-3">
        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
          <XAxis
            dataKey="dateLabel"
            tick={{ fontSize: 9 }}
            interval="preserveStartEnd"
            tickCount={6}
          />
          <YAxis tick={{ fontSize: 9 }} width={35} label={{ value: "Points", angle: -90, position: "insideLeft", style: { fontSize: 9 } }} />
          <RechartsTooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: "10px" }}
            formatter={(value: string) => value === "idealRemaining" ? "Ideal Remaining" : "Actual Remaining"}
          />
          <Line type="linear" dataKey="idealRemaining" stroke="#3b82f6" strokeWidth={2} dot={false} name="idealRemaining" />
          <Line type="monotone" dataKey="actualRemaining" stroke="#f97316" strokeWidth={2} dot={false} activeDot={<ActiveDot />} name="actualRemaining" />
          <ReferenceLine x={data[0].dateLabel} stroke="#888" strokeDasharray="3 3" label={{ value: "Start", position: "top", style: { fontSize: 9 } }} />
          <ReferenceLine x={data[data.length - 1].dateLabel} stroke="#888" strokeDasharray="3 3" label={{ value: "End", position: "top", style: { fontSize: 9 } }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Drill card ───────────────────────────────────────

function DrillCard({ label, logCount, totalPts, completedPts, onClick }: {
  label: string; logCount: number; totalPts: number; completedPts: number; onClick: () => void;
}) {
  const pct = totalPts > 0 ? Math.round((completedPts / totalPts) * 100) : 0;
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-md border border-border p-2 hover:bg-accent/50 transition-colors text-left w-full">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-xs truncate">{label}</p>
        <p className="text-[10px] text-muted-foreground">{logCount} updates</p>
      </div>
      <div className="text-right shrink-0">
        <span className="text-sm font-bold text-blue-600">{pct}%</span>
        <p className="text-[10px] text-muted-foreground">{completedPts.toFixed(0)}/{totalPts.toFixed(0)}</p>
      </div>
      <svg className="w-3 h-3 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────

export function RoadmapBurndown({ workstreams, progressLogs }: { workstreams: WorkstreamRow[]; progressLogs: ProgressLogEntry[] }) {
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ level: "overview", label: "All Workstreams" }]);
  const current = breadcrumbs[breadcrumbs.length - 1];

  const navigateTo = (crumb: Breadcrumb) => setBreadcrumbs((p) => [...p, crumb]);
  const navigateBack = (idx: number) => setBreadcrumbs((p) => p.slice(0, idx + 1));

  const { wsMap, delMap, featMap } = useMemo(() => {
    const wsMap = new Map<string, WorkstreamRow>();
    const delMap = new Map<string, { deliverable: DeliverableRow; workstream: WorkstreamRow }>();
    const featMap = new Map<string, { initiative: InitiativeRow; deliverable?: DeliverableRow; workstream: WorkstreamRow }>();
    for (const ws of workstreams) {
      wsMap.set(ws.id, ws);
      for (const del of ws.deliverables) {
        delMap.set(del.id, { deliverable: del, workstream: ws });
        for (const feat of del.initiatives) featMap.set(feat.id, { initiative: feat, deliverable: del, workstream: ws });
      }
      for (const feat of ws.initiatives ?? []) featMap.set(feat.id, { initiative: feat, workstream: ws });
    }
    return { wsMap, delMap, featMap };
  }, [workstreams]);

  const filteredLogs = useMemo(() => {
    if (current.level === "overview") return progressLogs;
    if (current.level === "workstream") return progressLogs.filter((l) => l.workstreamId === current.id);
    if (current.level === "deliverable") return progressLogs.filter((l) => l.deliverableId === current.id);
    if (current.level === "feature") return progressLogs.filter((l) => l.initiativeId === current.id);
    return progressLogs;
  }, [progressLogs, current]);

  const chartData = useMemo(() => buildBurndown(filteredLogs), [filteredLogs]);

  const children = useMemo(() => {
    const makeChildren = (items: { id: string; name: string }[], filterKey: keyof ProgressLogEntry, nextLevel: DrillLevel) =>
      items.map((item) => {
        const logs = progressLogs.filter((l) => l[filterKey] === item.id);
        return { id: item.id, label: item.name, logCount: logs.length, totalPts: logs.reduce((s, l) => s + l.totalPoints, 0), completedPts: logs.reduce((s, l) => s + l.currentPoints, 0), nextLevel };
      }).filter((c) => c.logCount > 0);

    if (current.level === "overview") return makeChildren(workstreams, "workstreamId", "workstream");
    if (current.level === "workstream") { const ws = wsMap.get(current.id!); return ws ? makeChildren(ws.deliverables, "deliverableId", "deliverable") : []; }
    if (current.level === "deliverable") { const d = delMap.get(current.id!); return d ? makeChildren(d.deliverable.initiatives, "initiativeId", "feature") : []; }
    if (current.level === "feature") { const f = featMap.get(current.id!); return f ? makeChildren(f.initiative.subTasks, "subTaskId", "feature" /* leaf */) : []; }
    return [];
  }, [current, workstreams, progressLogs, wsMap, delMap, featMap]);

  if (progressLogs.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-xs">
        No progress data yet. Sync to populate.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <nav className="flex items-center gap-1 text-xs flex-wrap">
        {breadcrumbs.map((crumb, idx) => (
          <span key={idx} className="flex items-center gap-1">
            {idx > 0 && <span className="text-muted-foreground">/</span>}
            {idx < breadcrumbs.length - 1 ? (
              <button onClick={() => navigateBack(idx)} className="text-blue-600 hover:underline">{crumb.label}</button>
            ) : (
              <span className="font-medium">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      <BurndownChart title={current.label} data={chartData} subtitle={`${filteredLogs.length} entries`} />

      {children.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            {current.level === "overview" ? "Workstreams" : current.level === "workstream" ? "Deliverables" : current.level === "deliverable" ? "Features" : "Tasks"}
          </h4>
          {children.map((c) => (
            <DrillCard key={c.id} label={c.label} logCount={c.logCount} totalPts={c.totalPts} completedPts={c.completedPts}
              onClick={() => { if (c.nextLevel) navigateTo({ level: c.nextLevel, id: c.id, label: c.label }); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

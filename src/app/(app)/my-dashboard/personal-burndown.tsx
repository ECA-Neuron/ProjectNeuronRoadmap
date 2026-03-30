"use client";

import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface TaskSnapshot { id: string; points: number; completionPercent: number; endDate?: string | null }

interface ProgressLog {
  id: string; taskName: string; logDate: string | null;
  percentComplete: number | null; currentPoints: number | null;
  totalPoints: number | null; updateComment: string | null;
  completedBy: string | null; subTaskId: string | null; initiativeId: string | null;
}

interface LogEntry { taskName: string; comment: string; pts: number; by: string }

interface ChartPoint {
  date: string;
  label: string;
  ideal: number;
  actual: number | null;
  logs: LogEntry[];
  hasUpdate: boolean;
}

function UpdateDot(props: any) {
  const { cx, cy, payload } = props;
  if (!payload?.hasUpdate || cx == null || cy == null) return null;
  return (
    <circle cx={cx} cy={cy} r={4} fill="#22c55e" stroke="#15803d" strokeWidth={1.5} style={{ filter: "drop-shadow(0 0 3px rgba(34,197,94,0.5))" }} />
  );
}

interface Props {
  totalPoints: number;
  tasks: TaskSnapshot[];
  progressLogs: ProgressLog[];
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point: ChartPoint = payload[0]?.payload;
  if (!point) return null;

  const fmtDate = new Date(point.date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });

  return (
    <div className="bg-card border border-border rounded-xl shadow-elevated px-3.5 py-3 max-w-[280px]" style={{ fontSize: 11 }}>
      <p className="font-semibold text-foreground mb-1.5">{fmtDate}</p>
      <div className="flex items-center gap-4 mb-1">
        <span className="text-muted-foreground">Ideal: <span className="font-semibold text-foreground tabular-nums">{point.ideal} pts</span></span>
        {point.actual != null && (
          <span className="text-muted-foreground">Remaining: <span className="font-semibold text-orange-500 tabular-nums">{point.actual} pts</span></span>
        )}
      </div>
      {point.logs.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border/40 space-y-1.5">
          {point.logs.map((log, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground truncate">{log.taskName}</span>
                  {log.pts > 0 && <span className="text-emerald-500 font-semibold tabular-nums shrink-0">+{log.pts} pts</span>}
                </div>
                {log.comment && (
                  <p className="text-muted-foreground text-[10px] mt-0.5 leading-snug">&ldquo;{log.comment}&rdquo;</p>
                )}
                {log.by && (
                  <p className="text-muted-foreground/60 text-[9px] mt-0.5">— {log.by}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PersonalBurndownChart({ totalPoints, tasks, progressLogs }: Props) {
  const data = useMemo<ChartPoint[]>(() => {
    if (totalPoints <= 0 || tasks.length === 0) return [];

    const today = new Date().toISOString().slice(0, 10);

    const taskEndDates = tasks
      .map(t => t.endDate)
      .filter(Boolean)
      .map(d => (d!.includes("T") ? d!.slice(0, 10) : d!))
      .sort();
    const lastTaskDate = taskEndDates.length > 0 ? taskEndDates[taskEndDates.length - 1] : null;
    const chartEnd = lastTaskDate && lastTaskDate > today ? lastTaskDate : today;

    const dated = progressLogs
      .filter(l => l.logDate && l.currentPoints != null && l.currentPoints > 0)
      .sort((a, b) => String(a.logDate!).localeCompare(String(b.logDate!)));

    let rangeStart = today;
    if (dated.length > 0) {
      rangeStart = new Date(String(dated[0].logDate!)).toISOString().slice(0, 10);
    }
    const taskStartDates = tasks
      .map(t => t.endDate)
      .filter(Boolean)
      .map(d => (d!.includes("T") ? d!.slice(0, 10) : d!))
      .sort();
    if (taskStartDates.length > 0 && taskStartDates[0]! < rangeStart) {
      rangeStart = taskStartDates[0]!;
    }

    const allDays: string[] = [];
    const cur = new Date(rangeStart + "T12:00:00Z");
    const end = new Date(chartEnd + "T12:00:00Z");
    while (cur <= end) {
      allDays.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (allDays.length === 0) return [];

    // Group burn points by day
    const burnByDay = new Map<string, number>();
    for (const l of dated) {
      const d = new Date(String(l.logDate!)).toISOString().slice(0, 10);
      burnByDay.set(d, (burnByDay.get(d) ?? 0) + (l.currentPoints ?? 0));
    }

    // Group ALL logs (including those with comments) by day for the tooltip
    const logsByDay = new Map<string, LogEntry[]>();
    for (const l of progressLogs) {
      if (!l.logDate) continue;
      const d = new Date(String(l.logDate)).toISOString().slice(0, 10);
      if (!logsByDay.has(d)) logsByDay.set(d, []);
      logsByDay.get(d)!.push({
        taskName: l.taskName || "Unknown",
        comment: l.updateComment || "",
        pts: l.currentPoints ?? 0,
        by: l.completedBy || "",
      });
    }

    const idealPerDay = totalPoints / Math.max(allDays.length - 1, 1);
    let cumBurnt = 0;

    return allDays.map((d, i) => {
      // Record the data point BEFORE applying today's burns so both lines start at totalPoints
      const actualVal = d <= today ? Math.max(0, Math.round(totalPoints - cumBurnt)) : null;

      const dt = new Date(d + "T12:00:00Z");
      const isMonthStart = dt.getUTCDate() === 1;
      const isWeekStart = dt.getUTCDay() === 1;
      const isFirst = i === 0;
      const isLast = i === allDays.length - 1;
      const showLabel = isFirst || isLast || isMonthStart || (allDays.length <= 60 && isWeekStart);

      // Apply burns after recording, so the drop appears on the next day
      cumBurnt += burnByDay.get(d) ?? 0;

      const dayLogs = logsByDay.get(d) ?? [];

      return {
        date: d,
        label: showLabel ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "",
        ideal: Math.max(0, Math.round(totalPoints - idealPerDay * i)),
        actual: actualVal,
        logs: dayLogs,
        hasUpdate: dayLogs.length > 0,
      };
    });
  }, [totalPoints, tasks, progressLogs]);

  if (data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
        No progress data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="burnGradPersonal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, "auto"]} />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey="ideal" stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="4 3" fill="none" dot={false} name="Ideal" connectNulls={false} />
        <Area type="monotone" dataKey="actual" stroke="#f97316" strokeWidth={2.5} fill="url(#burnGradPersonal)" dot={<UpdateDot />} activeDot={{ r: 5, fill: "#22c55e", stroke: "#15803d", strokeWidth: 2 }} name="Remaining" connectNulls={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

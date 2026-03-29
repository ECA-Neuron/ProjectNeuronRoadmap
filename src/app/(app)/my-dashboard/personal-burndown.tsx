"use client";

import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

interface ProgressLog {
  id: string; taskName: string; logDate: string | null;
  percentComplete: number | null; currentPoints: number | null;
  totalPoints: number | null; updateComment: string | null;
  completedBy: string | null; subTaskId: string | null; initiativeId: string | null;
}

interface Props {
  totalPoints: number;
  progressLogs: ProgressLog[];
}

export default function PersonalBurndownChart({ totalPoints, progressLogs }: Props) {
  const data = useMemo(() => {
    if (totalPoints <= 0 || progressLogs.length === 0) return [];

    const dated = progressLogs
      .filter(l => l.logDate)
      .sort((a, b) => String(a.logDate!).localeCompare(String(b.logDate!)));

    if (dated.length === 0) return [];

    const firstDate = new Date(String(dated[0].logDate!)).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const rangeEnd = today;

    const allDays: string[] = [];
    const cur = new Date(firstDate + "T12:00:00Z");
    const end = new Date(rangeEnd + "T12:00:00Z");
    while (cur <= end) {
      allDays.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    if (allDays.length === 0) return [];

    const byDay = new Map<string, typeof dated>();
    for (const l of dated) {
      const d = new Date(String(l.logDate!)).toISOString().slice(0, 10);
      if (d > today) continue;
      const arr = byDay.get(d) ?? [];
      arr.push(l);
      byDay.set(d, arr);
    }

    const idealPerDay = totalPoints / Math.max(allDays.length - 1, 1);
    let cumBurnt = 0;

    return allDays.map((d, i) => {
      const dayLogs = byDay.get(d) ?? [];
      cumBurnt += dayLogs.reduce((s, l) => s + (l.currentPoints ?? 0), 0);

      const dt = new Date(d + "T12:00:00Z");
      const isMonthStart = dt.getUTCDate() === 1;
      const isFirst = i === 0;
      const isLast = i === allDays.length - 1;
      const showLabel = isFirst || isLast || isMonthStart;

      return {
        date: d,
        label: showLabel ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "",
        ideal: Math.max(0, Math.round(totalPoints - idealPerDay * i)),
        actual: Math.max(0, totalPoints - cumBurnt),
      };
    });
  }, [totalPoints, progressLogs]);

  if (data.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        No progress data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="burnGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
          axisLine={false}
          tickLine={false}
          domain={[0, "auto"]}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 12,
            fontSize: 11,
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
          }}
          labelFormatter={(_, payload) => {
            const item = payload?.[0]?.payload;
            return item?.date ?? "";
          }}
        />
        <ReferenceLine y={0} stroke="hsl(var(--border))" />
        <Area
          type="monotone"
          dataKey="ideal"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={1}
          strokeDasharray="4 3"
          fill="none"
          dot={false}
          name="Ideal"
        />
        <Area
          type="monotone"
          dataKey="actual"
          stroke="#f97316"
          strokeWidth={2}
          fill="url(#burnGrad)"
          dot={false}
          name="Remaining"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

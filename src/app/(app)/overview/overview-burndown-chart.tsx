"use client";

import { useRef, useState, useEffect } from "react";
import {
  AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

export interface BurnPoint {
  date: string;
  label: string;
  idealRemaining: number;
  actualRemaining: number | null;
  projectedRemaining: number | null;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload as BurnPoint | undefined;
  if (!pt) return null;
  const fmtDate = (d: string) =>
    new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-2.5 text-xs z-50">
      <p className="font-semibold mb-1">{fmtDate(pt.date)}</p>
      <div className="flex flex-col gap-0.5">
        <span className="text-blue-600">Ideal: {pt.idealRemaining.toFixed(0)} pts</span>
        {pt.actualRemaining !== null && <span className="text-orange-600">Actual: {pt.actualRemaining.toFixed(0)} pts</span>}
        {pt.projectedRemaining !== null && pt.actualRemaining === null && <span className="text-orange-400">Projected: {pt.projectedRemaining.toFixed(0)} pts</span>}
      </div>
    </div>
  );
}

export default function OverviewBurndownChart({ data }: { data: BurnPoint[] }) {
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

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No progress data yet</p>;
  }

  return (
    <div ref={containerRef}>
      {chartWidth > 0 && (
        <AreaChart width={chartWidth} height={260} data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="overviewActualGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="overviewProjGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.1} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="label"
            fontSize={9}
            interval={0}
            height={40}
            tick={({ x, y, payload }: any) =>
              payload.value
                ? <text x={x} y={y + 10} textAnchor="end" fontSize={9} fill="#888" transform={`rotate(-35, ${x}, ${y + 10})`}>{payload.value}</text>
                : <g />
            }
          />
          <YAxis fontSize={10} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Area type="monotone" dataKey="actualRemaining" stroke="#f97316" strokeWidth={2} fill="url(#overviewActualGrad)" name="Actual Remaining" connectNulls={false} />
          <Area type="monotone" dataKey="projectedRemaining" stroke="#f97316" strokeWidth={1.5} strokeDasharray="6 4" fill="url(#overviewProjGrad)" name="Projected (velocity)" connectNulls={false} />
          <Area type="linear" dataKey="idealRemaining" stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 3" fill="none" name="Ideal Remaining" />
        </AreaChart>
      )}
    </div>
  );
}

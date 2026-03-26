"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubTaskRow {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  points: number;
  estimatedDays: number | null;
  completionPercent: number;
}

interface InitiativeRow {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  plannedStartMonth: string | null;
  plannedEndMonth: string | null;
  totalPoints: number;
  subTasks: SubTaskRow[];
}

interface DeliverableRow {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  points: number;
  initiatives: InitiativeRow[];
}

interface WorkstreamRow {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  color: string | null;
  deliverables: DeliverableRow[];
  initiatives: InitiativeRow[];
}

type Level = "workstream" | "deliverable" | "feature" | "task";

interface TimelineItem {
  id: string;
  name: string;
  level: Level;
  status: string;
  start: Date | null;
  end: Date | null;
  progress: number; // 0-100
  estimatedCompletion: string | null;
  depth: number;
  color: string;
  childCount: number;
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<Level, string> = {
  workstream: "#6366f1",
  deliverable: "#8b5cf6",
  feature: "#06b6d4",
  task: "#10b981",
};

const STATUS_BG: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  BLOCKED: "bg-red-100 text-red-700",
  DONE: "bg-green-100 text-green-700",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(d: string | null): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function monthToDate(ym: string | null): Date | null {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  return new Date(ym + "-01");
}

function computeProgress(items: { status: string; completionPercent?: number }[]): number {
  if (items.length === 0) return 0;
  let done = 0;
  for (const i of items) {
    if (i.status === "DONE") done += 100;
    else if (i.completionPercent != null) done += i.completionPercent;
    else if (i.status === "IN_PROGRESS") done += 50;
  }
  return Math.round(done / items.length);
}

function daysFromNow(date: Date | null): string | null {
  if (!date) return null;
  const now = new Date();
  const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Due today";
  if (diff <= 7) return `${diff}d left`;
  if (diff <= 30) return `${Math.ceil(diff / 7)}w left`;
  return `${Math.ceil(diff / 30)}mo left`;
}

function estimateCompletion(
  start: Date | null,
  end: Date | null,
  estimatedDays: number | null,
  progress: number
): string | null {
  if (end) return daysFromNow(end);
  if (start && estimatedDays && progress < 100) {
    const remaining = estimatedDays * ((100 - progress) / 100);
    const est = new Date();
    est.setDate(est.getDate() + Math.ceil(remaining));
    return daysFromNow(est);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data Flattening
// ---------------------------------------------------------------------------

function flattenWorkstreams(workstreams: WorkstreamRow[]): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const ws of workstreams) {
    const allInits = [
      ...ws.deliverables.flatMap((d) => d.initiatives),
      ...ws.initiatives,
    ];
    const allSubs = allInits.flatMap((i) => i.subTasks);
    const wsProgress = computeProgress([
      ...allInits.map((i) => ({ status: i.status })),
      ...allSubs,
    ]);

    items.push({
      id: ws.id,
      name: ws.name,
      level: "workstream",
      status: ws.status,
      start: toDate(ws.startDate),
      end: toDate(ws.endDate),
      progress: wsProgress,
      estimatedCompletion: estimateCompletion(
        toDate(ws.startDate),
        toDate(ws.endDate),
        null,
        wsProgress
      ),
      depth: 0,
      color: ws.color ?? LEVEL_COLORS.workstream,
      childCount: ws.deliverables.length + ws.initiatives.length,
    });

    for (const del of ws.deliverables) {
      const delProgress = computeProgress([
        ...del.initiatives.map((i) => ({ status: i.status })),
        ...del.initiatives.flatMap((i) => i.subTasks),
      ]);

      items.push({
        id: del.id,
        name: del.name,
        level: "deliverable",
        status: del.status,
        start: toDate(del.startDate),
        end: toDate(del.endDate),
        progress: delProgress,
        estimatedCompletion: estimateCompletion(
          toDate(del.startDate),
          toDate(del.endDate),
          null,
          delProgress
        ),
        depth: 1,
        color: LEVEL_COLORS.deliverable,
        childCount: del.initiatives.length,
      });

      for (const init of del.initiatives) {
        addInitiative(items, init, 2);
      }
    }

    // Initiatives not under a deliverable
    for (const init of ws.initiatives) {
      addInitiative(items, init, 1);
    }
  }

  return items;
}

function addInitiative(items: TimelineItem[], init: InitiativeRow, depth: number) {
  const initProgress = computeProgress(init.subTasks);
  const start =
    toDate(init.startDate) ?? monthToDate(init.plannedStartMonth);
  const end =
    toDate(init.endDate) ?? monthToDate(init.plannedEndMonth);

  items.push({
    id: init.id,
    name: init.name,
    level: "feature",
    status: init.status,
    start,
    end,
    progress: initProgress,
    estimatedCompletion: estimateCompletion(start, end, null, initProgress),
    depth,
    color: LEVEL_COLORS.feature,
    childCount: init.subTasks.length,
  });

  for (const sub of init.subTasks) {
    const subStart = toDate(sub.startDate);
    const subEnd = toDate(sub.endDate);

    items.push({
      id: sub.id,
      name: sub.name,
      level: "task",
      status: sub.status,
      start: subStart,
      end: subEnd,
      progress: sub.completionPercent,
      estimatedCompletion: estimateCompletion(
        subStart,
        subEnd,
        sub.estimatedDays,
        sub.completionPercent
      ),
      depth: depth + 1,
      color: LEVEL_COLORS.task,
      childCount: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Gantt helpers
// ---------------------------------------------------------------------------

function getTimelineBounds(items: TimelineItem[]): { minDate: Date; maxDate: Date } {
  const now = new Date();
  let min = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  let max = new Date(now.getFullYear() + 1, now.getMonth(), 1);

  for (const item of items) {
    if (item.start && item.start < min) min = item.start;
    if (item.end && item.end > max) max = item.end;
  }

  return { minDate: min, maxDate: max };
}

function getMonthsBetween(start: Date, end: Date): Date[] {
  const months: Date[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function dateToPercent(date: Date, min: Date, range: number): number {
  return ((date.getTime() - min.getTime()) / range) * 100;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TimelineView({ workstreams }: { workstreams: WorkstreamRow[] }) {
  const allItems = useMemo(() => flattenWorkstreams(workstreams), [workstreams]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filterLevel, setFilterLevel] = useState<Level | "all">("all");

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build visible items considering collapsed parents
  const visibleItems = useMemo(() => {
    const visible: TimelineItem[] = [];
    const hiddenParents = new Set<string>();

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];

      // Check if any ancestor is collapsed
      let hidden = false;
      for (let j = i - 1; j >= 0; j--) {
        if (allItems[j].depth < item.depth && collapsed.has(allItems[j].id)) {
          hidden = true;
          break;
        }
        if (allItems[j].depth < item.depth) break;
      }

      if (!hidden) {
        if (filterLevel === "all" || item.level === filterLevel) {
          visible.push(item);
        }
      }
    }
    return visible;
  }, [allItems, collapsed, filterLevel]);

  const { minDate, maxDate } = useMemo(
    () => getTimelineBounds(allItems),
    [allItems]
  );
  const range = maxDate.getTime() - minDate.getTime();
  const months = useMemo(
    () => getMonthsBetween(minDate, maxDate),
    [minDate, maxDate]
  );
  const todayPercent = dateToPercent(new Date(), minDate, range);

  // Stats
  const totalItems = allItems.length;
  const doneItems = allItems.filter((i) => i.status === "DONE").length;
  const inProgressItems = allItems.filter((i) => i.status === "IN_PROGRESS").length;
  const overallProgress =
    totalItems > 0
      ? Math.round(allItems.reduce((s, i) => s + i.progress, 0) / totalItems)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Timeline</h1>
        <p className="text-muted-foreground mt-1">
          Gantt view of all workstreams, deliverables, features, and tasks
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Items</p>
            <p className="text-2xl font-bold">{totalItems}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Done</p>
            <p className="text-2xl font-bold text-green-600">{doneItems}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">In Progress</p>
            <p className="text-2xl font-bold text-blue-600">{inProgressItems}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overall Progress</p>
            <p className="text-2xl font-bold">{overallProgress}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Filter:</span>
        {(["all", "workstream", "deliverable", "feature", "task"] as const).map(
          (level) => (
            <Button
              key={level}
              variant={filterLevel === level ? "default" : "outline"}
              size="sm"
              className="text-xs capitalize"
              onClick={() => setFilterLevel(level)}
            >
              {level === "all" ? "All Levels" : level + "s"}
            </Button>
          )
        )}
      </div>

      {/* Gantt chart */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="min-w-[1200px]">
            {/* Header — month columns */}
            <div className="flex border-b sticky top-0 bg-card z-10">
              <div className="w-[360px] shrink-0 border-r px-3 py-2 text-xs font-medium text-muted-foreground">
                Item
              </div>
              <div className="flex-1 relative">
                <div className="flex">
                  {months.map((m, idx) => {
                    const pct = 100 / months.length;
                    return (
                      <div
                        key={idx}
                        className="text-center text-[10px] font-medium text-muted-foreground py-2 border-r border-dashed"
                        style={{ width: `${pct}%` }}
                      >
                        {m.toLocaleDateString("en-US", {
                          month: "short",
                          year: "2-digit",
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Rows */}
            {visibleItems.map((item) => {
              const hasChildren = item.childCount > 0;
              const isCollapsed = collapsed.has(item.id);

              // Bar position
              let barLeft = 0;
              let barWidth = 0;
              if (item.start && item.end) {
                barLeft = dateToPercent(item.start, minDate, range);
                barWidth = dateToPercent(item.end, minDate, range) - barLeft;
                barWidth = Math.max(barWidth, 0.5);
              } else if (item.start) {
                barLeft = dateToPercent(item.start, minDate, range);
                barWidth = 2;
              }

              return (
                <div
                  key={item.id}
                  className="flex border-b hover:bg-accent/30 transition-colors"
                >
                  {/* Label column */}
                  <div
                    className="w-[360px] shrink-0 border-r flex items-center gap-1.5 py-1.5 pr-2 text-sm"
                    style={{ paddingLeft: `${12 + item.depth * 20}px` }}
                  >
                    {hasChildren && (
                      <button
                        onClick={() => toggleCollapse(item.id)}
                        className="w-4 h-4 flex items-center justify-center text-[10px] text-muted-foreground hover:text-foreground rounded"
                      >
                        {isCollapsed ? "+" : "−"}
                      </button>
                    )}
                    {!hasChildren && <span className="w-4" />}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate font-medium text-xs">
                      {item.name}
                    </span>
                    <Badge
                      variant="outline"
                      className="ml-auto text-[9px] shrink-0 capitalize"
                    >
                      {item.level}
                    </Badge>
                    {item.estimatedCompletion && (
                      <span
                        className={`text-[9px] shrink-0 ${
                          item.estimatedCompletion.includes("overdue")
                            ? "text-red-500 font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {item.estimatedCompletion}
                      </span>
                    )}
                  </div>

                  {/* Bar column */}
                  <div className="flex-1 relative py-1.5">
                    {/* Today marker */}
                    {todayPercent > 0 && todayPercent < 100 && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
                        style={{ left: `${todayPercent}%` }}
                      />
                    )}

                    {barWidth > 0 && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 rounded-full h-5 flex items-center"
                        style={{
                          left: `${barLeft}%`,
                          width: `${barWidth}%`,
                          minWidth: "6px",
                          backgroundColor: item.color + "30",
                          border: `1px solid ${item.color}60`,
                        }}
                      >
                        {/* Progress fill */}
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${item.progress}%`,
                            backgroundColor: item.color + "80",
                          }}
                        />
                        {barWidth > 5 && (
                          <span className="relative z-10 text-[9px] font-medium px-1.5 truncate">
                            {item.progress}%
                          </span>
                        )}
                      </div>
                    )}

                    {/* No dates — show status dot */}
                    {barWidth === 0 && (
                      <div className="flex items-center h-full px-2">
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded ${
                            STATUS_BG[item.status] ?? "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {item.status.replace(/_/g, " ")} — no dates
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {visibleItems.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                No items to display. Run a Notion sync from the Admin page to populate data.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

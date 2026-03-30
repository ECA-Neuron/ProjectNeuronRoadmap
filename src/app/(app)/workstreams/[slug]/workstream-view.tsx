"use client";

import { useState, useTransition, useMemo, useCallback, memo, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updateInitiativeField, updateInitiativeOwner } from "@/lib/actions/initiatives";
import { createSubTask, updateSubTaskCompletion, updateSubTask, updateSubTaskEstimation, deleteSubTask, toggleSubTaskAddedScope, updateSubTaskAssignee } from "@/lib/actions/subtasks";
import { saveMonthlySnapshot } from "@/lib/actions/snapshots";
import { getCurrentPeriod, getMonthlyPeriods } from "@/lib/burn-periods";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTrackedSave } from "@/hooks/use-autosave";
import { useRole } from "@/hooks/use-role";
import {
  computeStoryPoints,
  finalAsNumber,
  UNKNOWNS_LEVELS,
  INTEGRATION_LEVELS,
  type UnknownsLevel,
  type IntegrationLevel,
  type StoryPointsResult,
} from "@/lib/story-points";

/* ─── Types ───────────────────────────────────────────── */

interface CompletionNote {
  id: string;
  previousPercent: number;
  newPercent: number;
  reason: string;
  createdAt: string;
  user?: { id: string; name: string | null; email: string } | null;
}

interface SubTask {
  id: string;
  name: string;
  description: string | null;
  points: number;
  completionPercent: number;
  status: string;
  sortOrder: number;
  estimatedDays: number | null;
  unknowns: string | null;
  integration: string | null;
  isAddedScope: boolean;
  assigneeId: string | null;
  assignedOrganization?: "ECLIPSE" | "ACCENTURE" | null;
  completionNotes?: CompletionNote[];
}

interface Initiative {
  id: string;
  name: string;
  description: string | null;
  category: string;
  plannedStartMonth: string | null;
  plannedEndMonth: string | null;
  status: string;
  ownerInitials: string | null;
  ownerId: string | null;
  totalPoints: number;
  needsRefinement: boolean;
  sortOrder: number;
  subTasks: SubTask[];
  milestones: { id: string; name: string; date: string | null }[];
  partnerLinks: { partner: { id: string; name: string } }[];
  dependsOn: { dependsOn: { id: string; name: string; workstream: { name: string } } }[];
}

interface Person {
  id: string;
  name: string;
  initials: string | null;
  userId?: string | null;
}

interface OpenIssueSummary {
  id: string;
  title: string;
  severity: string;
  subTaskId: string | null;
  subTask: { id: string; name: string; initiativeId: string } | null;
}

interface Workstream {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  targetCompletionDate: string | null;
  status: string;
  color: string | null;
  programId: string;
  initiatives: Initiative[];
  partnerLinks: { partner: { id: string; name: string } }[];
}

/* ─── Status Colors ───────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700",
  BLOCKED: "bg-red-100 text-red-700",
  DONE: "bg-green-100 text-green-700",
};

const STATUS_BAR_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-gray-300",
  IN_PROGRESS: "bg-blue-500",
  BLOCKED: "bg-red-500",
  DONE: "bg-green-500",
};

/* ─── Helpers: compute from subtasks ──────────────────── */

/** Stable sort so subtask list order never changes after save/refresh. */
function sortSubTasksByOrder<T extends { id: string; sortOrder: number }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function computeSubTaskSP(st: SubTask): StoryPointsResult | null {
  if (st.estimatedDays == null || st.estimatedDays <= 0) return null;
  return computeStoryPoints({
    days: st.estimatedDays,
    unknowns: (st.unknowns as UnknownsLevel) || "None",
    integration: (st.integration as IntegrationLevel) || "Single system",
  });
}

/** Get the effective points for a subtask: computed if estimation inputs exist, else manual */
function effectiveSubTaskPoints(st: SubTask): number {
  const sp = computeSubTaskSP(st);
  if (sp) return sp.raw;
  return st.points;
}

/** Initiative total = sum of subtask effective points (or manual totalPoints if no subtasks) */
function computeTotalPoints(init: Initiative): { total: number; has21Plus: boolean } {
  if (init.subTasks.length === 0) return { total: init.totalPoints, has21Plus: false };
  let total = 0;
  let has21Plus = false;
  for (const st of init.subTasks) {
    const sp = computeSubTaskSP(st);
    if (sp) {
      total += sp.raw;
      if (sp.final === "21+") has21Plus = true;
    } else {
      total += st.points;
    }
  }
  return { total, has21Plus };
}

/** Burndown % for an initiative */
function computeBurndown(init: Initiative): number {
  if (init.subTasks.length === 0) {
    if (init.status === "DONE") return 100;
    if (init.status === "IN_PROGRESS") return 50;
    return 0;
  }
  const totalPts = init.subTasks.reduce((s, t) => s + effectiveSubTaskPoints(t), 0);
  if (totalPts === 0) {
    return Math.round(init.subTasks.reduce((s, t) => s + t.completionPercent, 0) / init.subTasks.length);
  }
  const completedPts = init.subTasks.reduce(
    (s, t) => s + (effectiveSubTaskPoints(t) * t.completionPercent) / 100,
    0
  );
  return Math.round((completedPts / totalPts) * 100);
}

/* ─── Workstream View Component ───────────────────────── */

interface BurnSnapshotRef {
  id: string;
  date: string;
  totalPoints: number;
  completedPoints: number;
  workstreamData?: Record<string, { name: string; totalPoints: number; completedPoints: number }> | null;
}

export default function WorkstreamView({
  workstream: ws,
  people,
  openIssues = [],
  users,
  burnSnapshots = [],
}: {
  workstream: Workstream;
  people: Person[];
  openIssues?: OpenIssueSummary[];
  users?: { id: string; name: string; email: string }[];
  burnSnapshots?: BurnSnapshotRef[];
}) {
  const [expandedInit, setExpandedInit] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const trackedSave = useTrackedSave();
  const { canEdit } = useRole();

  // Rollup: workstream-level totals
  const wsRollup = useMemo(() => {
    let totalPts = 0;
    let has21Plus = false;
    for (const init of ws.initiatives) {
      const r = computeTotalPoints(init);
      totalPts += r.total;
      if (r.has21Plus) has21Plus = true;
    }
    return { totalPts, has21Plus };
  }, [ws.initiatives]);

  // People lookup: initials → full name
  const peopleByInitials = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people) {
      if (p.initials) map.set(p.initials, p.name);
    }
    return map;
  }, [people]);

  function ownerLabel(initials: string | null): string {
    if (!initials) return "—";
    const name = peopleByInitials.get(initials);
    return name ? `${initials} — ${name}` : initials;
  }

  // Issues grouped by initiative (via subTask.initiativeId)
  const issuesByInitiative = useMemo(() => {
    const map = new Map<string, { total: number; stopping: number; slowing: number; notAConcern: number; issues: OpenIssueSummary[] }>();
    for (const issue of openIssues) {
      const initId = issue.subTask?.initiativeId;
      if (!initId) continue;
      if (!map.has(initId)) map.set(initId, { total: 0, stopping: 0, slowing: 0, notAConcern: 0, issues: [] });
      const entry = map.get(initId)!;
      entry.total++;
      entry.issues.push(issue);
      if (issue.severity === "STOPPING") entry.stopping++;
      else if (issue.severity === "SLOWING") entry.slowing++;
      else entry.notAConcern++;
    }
    return map;
  }, [openIssues]);

  // Total workstream-level issue counts
  const totalOpenIssues = openIssues.length;
  const totalStopping = openIssues.filter((i) => i.severity === "STOPPING").length;
  const totalSlowing = openIssues.filter((i) => i.severity === "SLOWING").length;

  const overallBurndown = ws.initiatives.length > 0
    ? Math.round(ws.initiatives.reduce((s, i) => s + computeBurndown(i), 0) / ws.initiatives.length)
    : 0;

  const statusCounts = ws.initiatives.reduce(
    (acc, i) => { acc[i.status] = (acc[i.status] || 0) + 1; return acc; },
    {} as Record<string, number>
  );

  const currentPeriod = useMemo(() => getCurrentPeriod(), []);
  const [periodSaved, setPeriodSaved] = useState(false);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState(currentPeriod.dateKey);

  // Generate monthly periods from Jan 2026 to current + 3 months
  const monthlyPeriods = useMemo(() => {
    const endYear = currentPeriod.month + 3 > 12 ? currentPeriod.year + 1 : currentPeriod.year;
    const endMonth = (currentPeriod.month + 3 - 1) % 12 + 1;
    return getMonthlyPeriods(2026, 1, endYear, endMonth);
  }, [currentPeriod]);

  // Map which periods have saved snapshots (check workstreamData for this ws)
  const savedPeriods = useMemo(() => {
    const set = new Set<string>();
    for (const snap of burnSnapshots) {
      set.add(snap.date);
    }
    return set;
  }, [burnSnapshots]);

  const refresh = useCallback(() => {
    startTransition(() => { router.refresh(); });
  }, [router]);

  function handleSaveProgress() {
    startTransition(async () => {
      await trackedSave(() => saveMonthlySnapshot(ws.programId));
      setPeriodSaved(true);
      refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: ws.color || "#888" }} />
            <h1 className="text-3xl font-bold">{ws.name}</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl">{ws.description}</p>
          {ws.targetCompletionDate && (
            <p className="text-sm font-medium text-primary mt-1">Target: {ws.targetCompletionDate}</p>
          )}
        </div>
        <div className="text-right min-w-[140px]">
          <p className="text-4xl font-bold">{overallBurndown}%</p>
          <p className="text-xs text-muted-foreground">overall burndown</p>
          <div className="mt-2 w-full bg-gray-200 rounded-full h-3">
            <div
              className="h-3 rounded-full bg-gradient-to-r from-blue-500 to-green-500 transition-all"
              style={{ width: `${overallBurndown}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {wsRollup.totalPts} total pts
            {wsRollup.has21Plus && (
              <Badge variant="destructive" className="ml-1 text-[9px]">has 21+</Badge>
            )}
          </p>
          {totalOpenIssues > 0 && (
            <Link href="/open-issues" className="mt-1 inline-flex items-center gap-1.5 text-xs hover:underline">
              <span className="font-semibold">
                {totalStopping > 0 && <span className="text-red-600">🔴 {totalStopping}</span>}
                {totalSlowing > 0 && <span className="text-yellow-600 ml-1">🟡 {totalSlowing}</span>}
              </span>
              <Badge variant="outline" className="text-[9px]">{totalOpenIssues} open issue{totalOpenIssues !== 1 ? "s" : ""}</Badge>
            </Link>
          )}
        </div>
      </div>

      {/* ── Status Cards ──────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE"].map((s) => (
          <Card key={s}>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground">{s.replace(/_/g, " ")}</p>
              <p className="text-2xl font-bold">{statusCounts[s] || 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Monthly Save Progress ──────────────────── */}
      <Card className="border-blue-200 bg-blue-50/30 overflow-visible">
        <CardContent className="pt-5 pb-4 space-y-3 min-w-0">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm">Save Progress — Monthly Snapshots</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select a month to view status. You can only save to the <strong>current month</strong>.
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              {(periodSaved || savedPeriods.has(currentPeriod.dateKey)) && (
                <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">Month Saved</Badge>
              )}
              {canEdit && (
                <Button
                  onClick={handleSaveProgress}
                  disabled={isPending}
                  size="sm"
                  className="whitespace-nowrap"
                >
                  {(periodSaved || savedPeriods.has(currentPeriod.dateKey)) ? "Update This Month" : "Save Progress for This Month"}
                </Button>
              )}
            </div>
          </div>
          {/* ── Month Dropdown ── */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <label className="text-xs font-semibold text-muted-foreground shrink-0">Month:</label>
            <select
              className="h-8 text-sm w-full sm:w-80 md:w-96 border rounded px-2 bg-background"
              value={selectedPeriodKey}
              onChange={(e) => setSelectedPeriodKey(e.target.value)}
            >
              {monthlyPeriods.map((p) => {
                const isCurr = p.dateKey === currentPeriod.dateKey;
                const isSaved = savedPeriods.has(p.dateKey);
                return (
                  <option key={p.dateKey} value={p.dateKey}>
                    {p.label}
                    {isCurr ? " (current)" : ""}
                    {isSaved ? " ✓" : ""}
                  </option>
                );
              })}
            </select>
            {selectedPeriodKey !== currentPeriod.dateKey && (
              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                Past/future month — read-only
              </Badge>
            )}
            {selectedPeriodKey === currentPeriod.dateKey && (
              <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300">
                Current month — saveable
              </Badge>
            )}
          </div>
          {/* ── Period snapshot details ── */}
          {selectedPeriodKey && (() => {
            const snap = burnSnapshots.find(s => s.date === selectedPeriodKey);
            if (!snap) {
              return (
                <div className="text-xs text-muted-foreground bg-white/60 rounded-md p-2 border">
                  No snapshot saved for this period yet.
                  {selectedPeriodKey === currentPeriod.dateKey && " Click the button above to save."}
                </div>
              );
            }
            const wsEntry = snap.workstreamData?.[ws.id];
            const pct = snap.totalPoints > 0 ? Math.round((snap.completedPoints / snap.totalPoints) * 100) : 0;
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white/60 rounded-md p-3 border text-xs">
                <div>
                  <span className="text-muted-foreground">Program Total</span>
                  <p className="font-semibold text-sm">{snap.totalPoints} pts</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Program Completed</span>
                  <p className="font-semibold text-sm text-green-600">{snap.completedPoints} pts ({pct}%)</p>
                </div>
                {wsEntry && (
                  <>
                    <div>
                      <span className="text-muted-foreground">This Workstream Total</span>
                      <p className="font-semibold text-sm">{wsEntry.totalPoints} pts</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">This Workstream Done</span>
                      <p className="font-semibold text-sm text-green-600">
                        {wsEntry.completedPoints} pts ({wsEntry.totalPoints > 0 ? Math.round((wsEntry.completedPoints / wsEntry.totalPoints) * 100) : 0}%)
                      </p>
                    </div>
                  </>
                )}
                {!wsEntry && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground italic">No per-workstream data for this snapshot (save again to capture)</span>
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* ── Partners ──────────────────────────────────── */}
      {ws.partnerLinks.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground">Partners:</span>
          {ws.partnerLinks.map((pl) => (
            <Link key={pl.partner.id} href="/partners">
              <Badge variant="secondary" className="cursor-pointer text-xs">{pl.partner.name}</Badge>
            </Link>
          ))}
        </div>
      )}

      {/* ── Initiatives ───────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Initiatives ({ws.initiatives.length})</h2>
        {ws.initiatives.map((init) => {
          const isExpanded = expandedInit === init.id;
          const burndown = computeBurndown(init);
          const rollup = computeTotalPoints(init);

          return (
            <Card key={init.id} className="overflow-visible">
              {/* ── Initiative Header Row ── */}
              <div
                className="p-4 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => setExpandedInit(isExpanded ? null : init.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-mono text-muted-foreground">{isExpanded ? "−" : "+"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold truncate">{init.name}</h3>
                      <Badge className={STATUS_COLORS[init.status] || ""} variant="secondary">
                        {init.status.replace(/_/g, " ")}
                      </Badge>
                      {init.needsRefinement && (
                        <Badge variant="destructive" className="text-[10px]">⚠ Refine</Badge>
                      )}
                      {rollup.has21Plus && (
                        <Badge variant="destructive" className="text-[10px]">⚠ 21+ items</Badge>
                      )}
                      {/* Open Issues badges */}
                      {(() => {
                        const initIssues = issuesByInitiative.get(init.id);
                        if (!initIssues || initIssues.total === 0) return null;
                        return (
                          <Link
                            href="/open-issues"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1"
                            title={`${initIssues.total} open issue(s) — click to view`}
                          >
                            {initIssues.stopping > 0 && (
                              <Badge variant="destructive" className="text-[10px]">🔴 {initIssues.stopping}</Badge>
                            )}
                            {initIssues.slowing > 0 && (
                              <Badge variant="secondary" className="text-[10px] bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400">🟡 {initIssues.slowing}</Badge>
                            )}
                            {initIssues.notAConcern > 0 && (
                              <Badge variant="outline" className="text-[10px]">🟢 {initIssues.notAConcern}</Badge>
                            )}
                          </Link>
                        );
                      })()}
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>{init.plannedStartMonth || "TBD"} → {init.plannedEndMonth || "TBD"}</span>
                      <span>Owner: <strong>{ownerLabel(init.ownerInitials)}</strong></span>
                      <span className="font-semibold text-foreground">{rollup.total} pts</span>
                      <span className="uppercase">{init.category.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                  {/* ── Burndown Ring ── */}
                  <div className="flex-shrink-0 text-center w-20">
                    <div className="relative w-14 h-14 mx-auto">
                      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                        <circle cx="28" cy="28" r="24" fill="none" stroke="#e5e7eb" strokeWidth="5" />
                        <circle
                          cx="28" cy="28" r="24" fill="none"
                          stroke={burndown === 100 ? "#22c55e" : burndown > 0 ? "#3b82f6" : "#d1d5db"}
                          strokeWidth="5"
                          strokeDasharray={`${(burndown / 100) * 150.8} 150.8`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                        {burndown}%
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">burndown</p>
                  </div>
                </div>
              </div>

              {/* ── Expanded Initiative Detail ── */}
              {isExpanded && (
                <div className="border-t bg-muted/20 p-4 space-y-5">
                  {/* Description */}
                  {init.description && (
                    <p className="text-sm text-muted-foreground">{init.description}</p>
                  )}

                  {/* ── Editable Fields Row ── */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {/* Owner (people tag) — sets both owner label and linked user for dashboard */}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">Owner</label>
                      <Select
                        className="h-8 text-xs"
                        defaultValue={people.find(p => p.initials === init.ownerInitials || p.name === init.ownerInitials)?.id ?? "__none"}
                        onChange={(e) => {
                          const personId = e.target.value === "__none" ? null : e.target.value;
                          startTransition(async () => {
                            await trackedSave(() => updateInitiativeOwner(init.id, personId));
                            refresh();
                          });
                        }}
                      >
                        <option value="__none">Unassigned</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.initials ? `${p.initials} — ${p.name}` : p.name}
                          </option>
                        ))}
                      </Select>
                    </div>

                    {/* Status */}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">Status</label>
                      <Select
                        className="h-8 text-xs"
                        defaultValue={init.status}
                        onChange={(e) => {
                          const val = e.target.value;
                          startTransition(async () => {
                            await trackedSave(() => updateInitiativeField(init.id, "status", val));
                            refresh();
                          });
                        }}
                      >
                        {["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "DONE"].map((s) => (
                          <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                        ))}
                      </Select>
                    </div>

                    {/* Start Date */}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">Start</label>
                      <Input
                        type="month"
                        className="h-8 text-xs"
                        defaultValue={init.plannedStartMonth || ""}
                        onBlur={(e) => {
                          if (e.target.value !== (init.plannedStartMonth || "")) {
                            startTransition(async () => {
                              await trackedSave(() => updateInitiativeField(init.id, "plannedStartMonth", e.target.value || null));
                              refresh();
                            });
                          }
                        }}
                      />
                    </div>

                    {/* End Date */}
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">End</label>
                      <Input
                        type="month"
                        className="h-8 text-xs"
                        defaultValue={init.plannedEndMonth || ""}
                        onBlur={(e) => {
                          if (e.target.value !== (init.plannedEndMonth || "")) {
                            startTransition(async () => {
                              await trackedSave(() => updateInitiativeField(init.id, "plannedEndMonth", e.target.value || null));
                              refresh();
                            });
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* ── Points Rollup ── */}
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-semibold text-muted-foreground">Total Points:</label>
                    {init.subTasks.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{rollup.total} pts</span>
                        <span className="text-xs text-muted-foreground">(sum of {init.subTasks.length} sub-tasks)</span>
                        {rollup.has21Plus && (
                          <Badge variant="destructive" className="text-[10px]">⚠ Contains 21+ items</Badge>
                        )}
                        <Link href="/docs/agile-estimation#rubric" className="text-[10px] text-primary underline ml-1" title="View story points rubric">
                          ❓ Rubric
                        </Link>
                      </div>
                    ) : (
                      <Input
                        type="number"
                        className="h-8 w-24 text-xs"
                        defaultValue={init.totalPoints}
                        min={0}
                        onBlur={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          if (val !== init.totalPoints) {
                            startTransition(async () => {
                              await trackedSave(() => updateInitiativeField(init.id, "totalPoints", val));
                              refresh();
                            });
                          }
                        }}
                      />
                    )}
                  </div>

                  {/* ── Milestones ── */}
                  {init.milestones.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">Milestones</p>
                      <div className="flex gap-2 flex-wrap">
                        {init.milestones.map((m) => (
                          <Badge key={m.id} variant="outline" className="text-xs font-mono">
                            {m.date || "TBD"} — {m.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Dependencies ── */}
                  {init.dependsOn.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold mb-1">Dependencies</p>
                      <div className="flex gap-2 flex-wrap">
                        {init.dependsOn.map((d) => (
                          <Badge key={d.dependsOn.id} variant="outline" className="text-xs">
                            {d.dependsOn.name} ({d.dependsOn.workstream.name})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Partners ── */}
                  {init.partnerLinks.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {init.partnerLinks.map((pl) => (
                        <Badge key={pl.partner.id} variant="secondary" className="text-[10px]">
                          {pl.partner.name}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* ── Sub-Tasks Section ── */}
                  <div className="space-y-2 overflow-visible">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold">
                          Sub-Components ({init.subTasks.length})
                        </h4>
                        <Link href="/docs/agile-estimation#rubric" className="text-[10px] text-primary underline" title="View story points rubric">
                          ❓ Rubric
                        </Link>
                      </div>
                      {canEdit && <AddSubTaskButton initiativeId={init.id} onDone={refresh} people={people} />}
                    </div>

                    {init.subTasks.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4 border rounded-md border-dashed">
                        No sub-components yet. Add one to split this initiative into trackable tasks.
                      </p>
                    )}

                    {/* Sub-task column headers */}
                    {(() => {
                      const sortedSubTasks = sortSubTasksByOrder(init.subTasks || []);
                      return (
                        <>
                          {sortedSubTasks.length > 0 && (
                            <div className="grid grid-cols-[1fr_60px_80px_44px_80px_80px_32px_32px_32px_40px_1fr_28px] gap-0.5 text-[9px] font-semibold text-muted-foreground px-2 border-b pb-1">
                              <span>Name</span>
                              <span>Assignee</span>
                              <span>Assigned Org</span>
                              <span>Days</span>
                              <span>Unknowns</span>
                              <span>Integration</span>
                              <span>Base</span>
                              <span>+Unk</span>
                              <span>+Int</span>
                              <span>Final</span>
                              <span>Done %</span>
                              <span></span>
                            </div>
                          )}
                          {sortedSubTasks.map((st) => (
                            <SubTaskRow key={st.id} subTask={st} people={people} onUpdate={refresh} trackedSave={trackedSave} />
                          ))}
                        </>
                      );
                    })()}

                    {/* Sub-task points summary bar + dropdown of all completion comments */}
                    {init.subTasks.length > 0 && (() => {
                      const allNotes = init.subTasks.flatMap((st) =>
                        (st.completionNotes ?? []).map((n) => ({ subTaskName: st.name, ...n }))
                      ).sort((a, b) => {
                        const t = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                        if (t !== 0) return t;
                        return (a.id || "").localeCompare(b.id || "");
                      });
                      return (
                        <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                          <div className="flex justify-between text-xs font-semibold mb-1">
                            <span>Sub-component progress</span>
                            <span>{burndown}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div
                              className="h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-green-500 transition-all"
                              style={{ width: `${burndown}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span>
                              {rollup.total} pts total ({init.subTasks.length} sub-tasks)
                              {init.subTasks.some(s => s.isAddedScope) && (
                                <span className="ml-1 text-purple-600">
                                  · {init.subTasks.filter(s => s.isAddedScope).reduce((s, t) => s + effectiveSubTaskPoints(t), 0)} added scope
                                </span>
                              )}
                            </span>
                            <span>{init.subTasks.filter(s => s.status === "DONE").length}/{init.subTasks.length} complete</span>
                          </div>
                          {allNotes.length > 0 && (
                            <details className="group/details border rounded-md bg-background/80">
                              <summary className="cursor-pointer list-none px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
                                <span>▼ Completion history ({allNotes.length})</span>
                              </summary>
                              <div className="px-2 pb-2 pt-0 space-y-1.5 max-h-48 overflow-y-auto text-xs border-t mt-1">
                                {allNotes.map((n) => (
                                  <div key={n.id} className="py-1.5 border-b border-muted/50 last:border-0">
                                    <span className="font-semibold text-muted-foreground">{n.subTaskName}</span>
                                    {" · "}
                                    <span className="font-medium">{n.previousPercent}% → {n.newPercent}%</span>
                                    {" — "}
                                    <span>{n.reason || "—"}</span>
                                    <span className="text-muted-foreground ml-1 block sm:inline">
                                      {new Date(n.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                                      {n.user && (
                                        <> · by {n.user.name ?? n.user.email}</>
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </Card>
          );
        })}

        {ws.initiatives.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No initiatives in this workstream.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-Task Row ─────────────────────────────────────── */

const SubTaskRow = memo(function SubTaskRow({ subTask: st, people, onUpdate, trackedSave }: { subTask: SubTask; people: Person[]; onUpdate: () => void; trackedSave: <T>(action: () => Promise<T>) => Promise<T | undefined> }) {
  const [isPending, startTransition] = useTransition();
  const [savingProgress, setSavingProgress] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(st.name);

  // Local estimation state for immediate recompute
  const [days, setDays] = useState<number | "">(st.estimatedDays ?? "");
  const [unknowns, setUnknowns] = useState<string>(st.unknowns || "None");
  const [integration, setIntegration] = useState<string>(st.integration || "Single system");
  const [completionInput, setCompletionInput] = useState<string>(String(st.completionPercent));
  const [completionReason, setCompletionReason] = useState("");
  const [optimisticNotes, setOptimisticNotes] = useState<CompletionNote[]>([]);

  // Compute story points from local state
  const sp: StoryPointsResult | null = useMemo(() => {
    if (days === "" || days <= 0) return null;
    return computeStoryPoints({
      days: typeof days === "number" ? days : 0,
      unknowns: unknowns as UnknownsLevel,
      integration: integration as IntegrationLevel,
    });
  }, [days, unknowns, integration]);

  const effectivePoints = sp ? sp.raw : st.points;
  const barColor = st.completionPercent === 100 ? "bg-green-500" : st.completionPercent > 0 ? "bg-blue-500" : "bg-gray-300";
  const isBreakDown = sp?.flags.includes("break_down_required");
  const isVeryHigh = sp?.flags.includes("very_high_unknowns");

  // Sync completion % from server after refresh
  useEffect(() => {
    setCompletionInput(String(st.completionPercent));
  }, [st.completionPercent]);

  // When server sends updated notes (after refresh), clear optimistic list so we show server data
  const prevNotesLengthRef = useRef((st.completionNotes?.length ?? 0));
  useEffect(() => {
    const currentLen = st.completionNotes?.length ?? 0;
    if (currentLen > prevNotesLengthRef.current) {
      setOptimisticNotes([]);
    }
    prevNotesLengthRef.current = currentLen;
  }, [st.completionNotes?.length]);

  const displayNotes = useMemo(() => {
    const combined = [...(st.completionNotes ?? []), ...optimisticNotes];
    // Stable sort: newest first, then by id so order doesn't flip when timestamps tie or data refreshes
    return combined.sort((a, b) => {
      const t = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (t !== 0) return t;
      return (a.id || "").localeCompare(b.id || "");
    });
  }, [st.completionNotes, optimisticNotes]);

  function persistEstimation(overrides?: { days?: number | null; unknowns?: string | null; integration?: string | null }) {
    const d = overrides?.days !== undefined ? overrides.days : (typeof days === "number" ? days : null);
    const u = overrides?.unknowns !== undefined ? overrides.unknowns : unknowns;
    const ig = overrides?.integration !== undefined ? overrides.integration : integration;

    let pts = st.points;
    if (d != null && d > 0) {
      const result = computeStoryPoints({
        days: d,
        unknowns: (u as UnknownsLevel) || "None",
        integration: (ig as IntegrationLevel) || "Single system",
      });
      pts = result.raw;
    }

    startTransition(async () => {
      await trackedSave(() => updateSubTaskEstimation(st.id, {
        estimatedDays: d,
        unknowns: u,
        integration: ig,
        points: pts,
      }));
      onUpdate();
    });
  }

  return (
    <div
      className={`rounded border p-1.5 transition-colors group flex flex-col gap-0 ${
        isBreakDown ? "border-red-400 bg-red-50 dark:bg-red-950/20" :
        st.isAddedScope ? "border-purple-300 bg-purple-50/50 dark:bg-purple-950/10" :
        "hover:bg-accent/20"
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-[1fr_60px_80px_44px_80px_80px_32px_32px_32px_40px_1fr_28px] gap-0.5 items-center min-h-[2rem]">
        {/* Name + Added Scope badge */}
        <div className="min-w-0">
          {editing ? (
            <div className="flex gap-1 items-center">
              <Input
                className="h-6 text-[10px] flex-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <Button
                size="sm" variant="outline" className="h-5 text-[9px] px-1.5"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    await trackedSave(() => updateSubTask(st.id, { name }));
                    setEditing(false);
                    onUpdate();
                  });
                }}
              >
                Save
              </Button>
              <Button
                size="sm" variant="ghost" className="h-5 text-[9px] px-1"
                onClick={() => { setEditing(false); setName(st.name); }}
              >
                ✕
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_BAR_COLORS[st.status]}`} />
              <span
                className="text-[10px] font-medium cursor-pointer hover:underline truncate"
                onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                title={st.name}
              >
                {st.name}
              </span>
              {/* Added Scope toggle */}
              <button
                className={`ml-auto flex-shrink-0 text-[8px] px-1.5 py-0.5 rounded border leading-none font-semibold transition-colors ${
                  st.isAddedScope
                    ? "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900 dark:text-purple-300"
                    : "bg-gray-50 text-muted-foreground border-gray-200 hover:border-purple-300 hover:bg-purple-50 hover:text-purple-600 dark:bg-gray-900 dark:hover:bg-purple-950/30"
                }`}
                title={st.isAddedScope ? "Added scope — click to mark as original" : "Click to mark as added scope (effort added later)"}
                onClick={(e) => {
                  e.stopPropagation();
                  startTransition(async () => {
                    await trackedSave(() => toggleSubTaskAddedScope(st.id, !st.isAddedScope));
                    onUpdate();
                  });
                }}
              >
                {st.isAddedScope ? "✦ Added" : "+ Add Scope"}
              </button>
            </div>
          )}
        </div>

        {/* Assignee dropdown */}
        <select
          className="h-5 text-[9px] border rounded px-0.5 bg-background truncate"
          value={st.assigneeId || "__none"}
          onChange={(e) => {
            const val = e.target.value;
            startTransition(async () => {
              await trackedSave(() => updateSubTaskAssignee(st.id, val === "__none" ? null : val));
              onUpdate();
            });
          }}
        >
          <option value="__none">—</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.initials || p.name}</option>
          ))}
        </select>

        {/* Assigned Organization — same pattern as Assignee: updateSubTask with one field */}
        <select
          className="h-5 text-[9px] border rounded px-0.5 bg-background truncate"
          value={st.assignedOrganization ?? "__none"}
          onChange={(e) => {
            const val = e.target.value;
            const org = val === "__none" ? null : (val as "ECLIPSE" | "ACCENTURE");
            startTransition(async () => {
              await trackedSave(() => updateSubTask(st.id, { assignedOrganization: org }));
              onUpdate();
            });
          }}
        >
          <option value="__none">—</option>
          <option value="ECLIPSE">Eclipse</option>
          <option value="ACCENTURE">Accenture</option>
        </select>

        {/* Estimated Days */}
        <Input
          type="number"
          className="h-5 text-[10px] w-full px-1"
          value={days}
          min={0}
          max={30}
          step={1}
          placeholder="—"
          onChange={(e) => {
            const v = e.target.value === "" ? "" : parseFloat(e.target.value);
            setDays(v);
          }}
          onBlur={() => {
            const d = typeof days === "number" ? days : null;
            if (d !== st.estimatedDays) {
              persistEstimation({ days: d });
            }
          }}
        />

        {/* Unknowns */}
        <select
          className="h-5 text-[9px] border rounded px-0.5 bg-background"
          value={unknowns}
          onChange={(e) => {
            setUnknowns(e.target.value);
            persistEstimation({ unknowns: e.target.value });
          }}
        >
          {UNKNOWNS_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>{lvl}</option>
          ))}
        </select>

        {/* Integration */}
        <select
          className="h-5 text-[9px] border rounded px-0.5 bg-background"
          value={integration}
          onChange={(e) => {
            setIntegration(e.target.value);
            persistEstimation({ integration: e.target.value });
          }}
        >
          {INTEGRATION_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>{lvl}</option>
          ))}
        </select>

        {/* Base Points */}
        <span className="text-[9px] font-mono text-center text-muted-foreground">
          {sp ? sp.base : "—"}
        </span>

        {/* +Unknowns */}
        <span className="text-[9px] font-mono text-center text-muted-foreground">
          {sp ? `+${sp.unknownsAdj}` : "—"}
        </span>

        {/* +Integration */}
        <span className="text-[9px] font-mono text-center text-muted-foreground">
          {sp ? `+${sp.integrationAdj}` : "—"}
        </span>

        {/* Final Points */}
        <div className="text-center">
          {sp ? (
            <Badge
              variant={sp.final === "21+" ? "destructive" : "secondary"}
              className="font-mono text-[9px] px-1 py-0"
            >
              {sp.final === "21+" ? "21+" : sp.raw}
            </Badge>
          ) : (
            <span className="text-[9px] font-mono text-muted-foreground">{st.points || "—"}</span>
          )}
        </div>

        {/* Completion %: bigger progress bar with room; other columns shifted left */}
        <div className="min-w-0 flex items-center gap-2">
          <div className="flex-1 min-w-[60px] bg-muted/80 rounded-full h-3 overflow-hidden">
            <div
              className={`h-3 rounded-full transition-all duration-200 ${barColor}`}
              style={{ width: `${st.completionPercent}%` }}
            />
          </div>
          <div className="flex items-center gap-0.5 shrink-0 bg-background border border-input rounded-md shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              className="w-12 h-8 text-sm font-semibold font-mono text-right bg-transparent border-0 rounded-md px-1.5 py-0 focus:outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              value={completionInput}
              onChange={(e) => setCompletionInput(e.target.value)}
              onBlur={() => {
                const val = Math.max(0, Math.min(100, parseInt(completionInput) || 0));
                setCompletionInput(String(val));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="text-xs font-medium text-muted-foreground pr-1.5 select-none">%</span>
          </div>
        </div>

        {/* Delete */}
        <button
          className="h-3.5 w-3.5 p-0 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 flex-shrink-0 text-[8px] leading-none"
          title="Delete sub-task"
          onClick={() => {
            startTransition(async () => {
              await trackedSave(() => deleteSubTask(st.id));
              onUpdate();
            });
          }}
        >
          🗑
        </button>
      </div>

      {/* Directly under subcomponent: reason, Save, and completion history dropdown */}
      <div className="mt-1.5 pt-1.5 border-t border-border/50 space-y-1.5">
        <div className="flex gap-2 items-end flex-wrap">
          <textarea
            placeholder="Reason (optional) — then click Save"
            rows={2}
            className="flex-1 min-w-[200px] min-h-[2.5rem] text-xs border rounded px-2 py-1.5 bg-background resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            value={completionReason}
            onChange={(e) => setCompletionReason(e.target.value)}
          />
          <Button
            size="sm"
            variant="default"
            className="h-8 shrink-0 text-xs px-3"
            disabled={savingProgress}
            onClick={async () => {
              const val = Math.max(0, Math.min(100, parseInt(completionInput) || 0));
              setCompletionInput(String(val));
              const reason = completionReason.trim();
              const percentChanged = val !== st.completionPercent;
              if (percentChanged) {
                setOptimisticNotes((prev) => [
                  ...prev,
                  {
                    id: `opt-${Date.now()}`,
                    previousPercent: st.completionPercent,
                    newPercent: val,
                    reason: reason || "",
                    createdAt: new Date().toISOString(),
                  },
                ]);
              }
              setSavingProgress(true);
              setCompletionReason("");
              try {
                await trackedSave(() => updateSubTaskCompletion(st.id, val, reason || undefined));
                onUpdate();
              } finally {
                setSavingProgress(false);
              }
            }}
          >
            {savingProgress ? "Saving…" : "Save progress"}
          </Button>
        </div>
        {displayNotes.length > 0 && (
          <details className="group/details border rounded-md bg-muted/40" open={optimisticNotes.length > 0}>
            <summary className="cursor-pointer list-none px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
              <span>▼ Completion history ({displayNotes.length})</span>
            </summary>
            <div className="px-2 pb-2 pt-0 space-y-1 max-h-40 overflow-y-auto text-xs border-t mt-0.5">
              {displayNotes.map((n) => (
                <div key={n.id} className="py-1 border-b border-muted/50 last:border-0">
                  <span className="font-medium">{n.previousPercent}% → {n.newPercent}%</span>
                  {" — "}
                  <span>{n.reason || "—"}</span>
                  <span className="text-muted-foreground ml-1">
                    {new Date(n.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                    {"user" in n && n.user && <> · by {n.user.name ?? n.user.email}</>}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Warning flags */}
      {(isBreakDown || isVeryHigh) && (
        <div className="flex gap-2 mt-0.5 ml-1">
          {isBreakDown && (
            <span className="text-[9px] font-semibold text-red-600 dark:text-red-400">
              ⚠️ Break down (&ge;14d)
            </span>
          )}
          {isVeryHigh && (
            <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400">
              ⚠️ Consider spike / split
            </span>
          )}
        </div>
      )}
    </div>
  );
});

/* ─── Add Sub-Task Button ──────────────────────────────── */

function AddSubTaskButton({ initiativeId, onDone, people }: { initiativeId: string; onDone: () => void; people: Person[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setOpen(true)}>
        + Add
      </Button>
    );
  }

  return (
    <div className="flex gap-1 items-center">
      <Input
        className="h-6 text-[10px] w-40"
        placeholder="Sub-component name..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      {people.length > 0 && (
        <select
          className="h-6 text-[10px] bg-background border border-border rounded px-1 text-foreground"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">Unassigned</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.initials || p.name}</option>)}
        </select>
      )}
      <Button
        size="sm"
        className="h-6 text-[10px]"
        disabled={isPending || !name.trim()}
        onClick={() => {
          startTransition(async () => {
            await createSubTask({
              initiativeId,
              name: name.trim(),
              points: 0,
              ...(assigneeId ? { assigneeId } : {}),
            });
            setName("");
            setAssigneeId("");
            setOpen(false);
            onDone();
          });
        }}
      >
        Add
      </Button>
      <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1" onClick={() => setOpen(false)}>
        ✕
      </Button>
    </div>
  );
}

"use client";

import { useState, useTransition, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updateSubTask, updateSubTaskCompletion, updateSubTaskEstimation } from "@/lib/actions/subtasks";
import { useTrackedSave } from "@/hooks/use-autosave";
import { useRole } from "@/hooks/use-role";
import {
  computeStoryPoints,
  UNKNOWNS_LEVELS,
  INTEGRATION_LEVELS,
  type UnknownsLevel,
  type IntegrationLevel,
  type StoryPointsResult,
} from "@/lib/story-points";
import Link from "next/link";

interface CompletionNote {
  id: string;
  previousPercent: number;
  newPercent: number;
  reason: string;
  createdAt: string;
  user?: { id: string; name: string | null; email: string } | null;
}

interface SubTaskData {
  id: string;
  name: string;
  description: string | null;
  points: number;
  completionPercent: number;
  status: string;
  estimatedDays: number | null;
  unknowns: string | null;
  integration: string | null;
  isAddedScope: boolean;
  initiative: {
    id: string;
    name: string;
    workstream: { id: string; name: string; slug: string; color: string | null };
  };
  completionNotes?: CompletionNote[];
}

const STATUS_OPTIONS = ["NOT_STARTED", "IN_PROGRESS", "DONE"] as const;

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-gray-300",
  IN_PROGRESS: "bg-blue-500",
  BLOCKED: "bg-red-500",
  DONE: "bg-green-500",
};

function EditableSubTaskRow({ subTask: initial }: { subTask: SubTaskData }) {
  const [st, setSt] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [savingProgress, setSavingProgress] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(st.name);
  const [completionInput, setCompletionInput] = useState(String(st.completionPercent));
  const [completionReason, setCompletionReason] = useState("");
  const [optimisticNotes, setOptimisticNotes] = useState<CompletionNote[]>([]);
  const [days, setDays] = useState<number | "">(st.estimatedDays ?? "");
  const [unknowns, setUnknowns] = useState<string>(st.unknowns || "None");
  const [integration, setIntegration] = useState<string>(st.integration || "Single system");
  const router = useRouter();
  const trackedSave = useTrackedSave();

  function refresh() {
    startTransition(() => router.refresh());
  }

  const sp: StoryPointsResult | null = useMemo(() => {
    if (days === "" || days <= 0) return null;
    return computeStoryPoints({
      days: typeof days === "number" ? days : 0,
      unknowns: unknowns as UnknownsLevel,
      integration: integration as IntegrationLevel,
    });
  }, [days, unknowns, integration]);

  useEffect(() => {
    setCompletionInput(String(st.completionPercent));
  }, [st.completionPercent]);

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
      await trackedSave(() => updateSubTaskEstimation(st.id, { estimatedDays: d, unknowns: u, integration: ig, points: pts }));
      setSt((prev) => ({ ...prev, points: pts, estimatedDays: d, unknowns: u, integration: ig }));
      refresh();
    });
  }

  function handleCompletionBlur() {
    const val = Math.max(0, Math.min(100, parseInt(completionInput) || 0));
    setCompletionInput(String(val));
  }

  function handleStatusChange(newStatus: string) {
    const newPct = newStatus === "DONE" ? 100 : newStatus === "NOT_STARTED" ? 0 : st.completionPercent;
    setSt((prev) => ({ ...prev, status: newStatus, completionPercent: newPct }));
    setCompletionInput(String(newPct));
    startTransition(async () => {
      await trackedSave(() => updateSubTaskCompletion(st.id, newPct));
      refresh();
    });
  }

  function handleNameSave() {
    if (nameVal.trim() && nameVal !== st.name) {
      setSt((prev) => ({ ...prev, name: nameVal.trim() }));
      startTransition(async () => {
        await trackedSave(() => updateSubTask(st.id, { name: nameVal.trim() }));
        refresh();
      });
    }
    setEditingName(false);
  }

  const barColor = st.completionPercent === 100 ? "bg-green-500" : st.completionPercent > 0 ? "bg-blue-500" : "bg-gray-300";

  return (
    <div className={`border rounded-lg p-3 transition-colors ${isPending ? "opacity-60" : ""} ${
      st.isAddedScope ? "border-purple-300 bg-purple-50/30" : ""
    }`}>
      {/* Row 1: name + link */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[st.status]}`} />
          {editingName ? (
            <div className="flex gap-1 items-center flex-1">
              <Input
                className="h-7 text-sm flex-1"
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleNameSave(); if (e.key === "Escape") { setEditingName(false); setNameVal(st.name); } }}
                autoFocus
              />
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={handleNameSave}>Save</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-1" onClick={() => { setEditingName(false); setNameVal(st.name); }}>Cancel</Button>
            </div>
          ) : (
            <span
              className="font-medium text-sm cursor-pointer hover:underline truncate"
              onClick={() => setEditingName(true)}
              title="Click to edit name"
            >
              {st.name}
            </span>
          )}
          {st.isAddedScope && <Badge variant="secondary" className="text-[8px] bg-purple-100 text-purple-700 flex-shrink-0">Added Scope</Badge>}
        </div>
        <Link href={`/workstreams/${st.initiative.workstream.slug}`} className="text-[10px] text-primary hover:underline flex-shrink-0 ml-2">
          View in workstream
        </Link>
      </div>

      {/* Row 2: estimation levers + status + completion % (same as workstream: bar + styled input) */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <label className="text-[10px] text-muted-foreground">Days:</label>
          <input
            type="number"
            className="w-12 h-6 text-[10px] font-mono text-center border rounded bg-background"
            value={days}
            min={0}
            max={30}
            step={1}
            placeholder="—"
            onChange={(e) => setDays(e.target.value === "" ? "" : parseFloat(e.target.value))}
            onBlur={() => {
              const d = typeof days === "number" ? days : null;
              if (d !== st.estimatedDays) persistEstimation({ days: d });
            }}
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[10px] text-muted-foreground">Unk:</label>
          <select
            className="h-6 text-[10px] border rounded px-0.5 bg-background"
            value={unknowns}
            onChange={(e) => { setUnknowns(e.target.value); persistEstimation({ unknowns: e.target.value }); }}
          >
            {UNKNOWNS_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[10px] text-muted-foreground">Int:</label>
          <select
            className="h-6 text-[10px] border rounded px-0.5 bg-background"
            value={integration}
            onChange={(e) => { setIntegration(e.target.value); persistEstimation({ integration: e.target.value }); }}
          >
            {INTEGRATION_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
          </select>
        </div>
        <div className="border-l h-4 mx-0.5" />
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Pts:</span>
          {sp ? (
            <Badge variant={sp.final === "21+" ? "destructive" : "secondary"} className="font-mono text-[9px] px-1 py-0">
              {sp.final === "21+" ? "21+" : sp.raw}
            </Badge>
          ) : (
            <span className="text-[10px] font-mono font-semibold">{st.points || "—"}</span>
          )}
        </div>
        <div className="border-l h-4 mx-0.5" />
        <div className="flex items-center gap-1">
          <label className="text-[10px] text-muted-foreground">Status:</label>
          <select className="h-6 text-[10px] border rounded px-1 bg-background" value={st.status} onChange={(e) => handleStatusChange(e.target.value)}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        {/* Completion % — same as workstream: bigger bar + styled field */}
        <div className="flex items-center gap-2 flex-1 min-w-[140px]">
          <label className="text-[10px] text-muted-foreground shrink-0">Done:</label>
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
              onBlur={handleCompletionBlur}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            />
            <span className="text-xs font-medium text-muted-foreground pr-1.5 select-none">%</span>
          </div>
        </div>
      </div>

      {/* Under row: reason, Save progress, completion history (same as workstream) */}
      <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
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
              const hasComment = reason !== "";
              if (percentChanged || hasComment) {
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
                setSt((prev) => ({ ...prev, completionPercent: val, status: val === 100 ? "DONE" : val > 0 ? "IN_PROGRESS" : "NOT_STARTED" }));
                refresh();
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

      {/* Workstream context */}
      <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: st.initiative.workstream.color || "#888" }} />
          <span>{st.initiative.workstream.name} · {st.initiative.name}</span>
        </div>
      </div>

      {/* Warnings */}
      {sp && (sp.flags.includes("break_down_required") || sp.flags.includes("very_high_unknowns")) && (
        <div className="flex gap-2 mt-1">
          {sp.flags.includes("break_down_required") && <span className="text-[9px] font-semibold text-red-600">Break down (&ge;14d)</span>}
          {sp.flags.includes("very_high_unknowns") && <span className="text-[9px] font-semibold text-amber-600">Consider spike / split</span>}
        </div>
      )}
    </div>
  );
}

export default function MySubtasksList({ subtasks }: { subtasks: SubTaskData[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>My Assigned Subtasks</CardTitle>
          <span className="text-xs text-muted-foreground">{subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Edit here — changes sync to the workstream view. Use the same progress bar, reason, and completion history as on workstreams.
        </p>
      </CardHeader>
      <CardContent>
        {subtasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No subtasks assigned to you yet. Ask your lead to assign you from the workstream page.
          </p>
        ) : (
          <div className="space-y-2">
            {subtasks.map((st) => (
              <EditableSubTaskRow key={st.id} subTask={st} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

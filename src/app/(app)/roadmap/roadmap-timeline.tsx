"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { addRoadmapItem } from "@/lib/actions/add-roadmap-item";
import { updateRoadmapDates, updateRoadmapItem } from "@/lib/actions/update-roadmap-dates";
import { deleteRoadmapItem } from "@/lib/actions/delete-roadmap-item";
import { addDependency, removeDependency } from "@/lib/actions/dependencies";
import { DatePicker } from "@/components/ui/date-picker";

// ─── Types ───────────────────────────────────────────

interface PersonRef { id: string; name: string; initials: string | null }

interface SubTaskRow {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  completionPercent?: number;
  assignee: PersonRef | null;
}

interface InitiativeRow {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  ownerInitials: string | null;
  subTasks: SubTaskRow[];
}

interface DeliverableRow {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  initiatives: InitiativeRow[];
}

interface WorkstreamRow {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  color: string | null;
  deliverables: DeliverableRow[]; initiatives: InitiativeRow[];
}

type Level = "Workstream" | "Deliverable" | "Feature" | "Task";

interface FlatRow {
  id: string; name: string; level: Level; status: string;
  startDate: string | null; endDate: string | null;
  assign: string | null; depth: number; childCount: number;
  color: string; pct: number | null;
  initiativeId: string | null;
}

interface AddButtonRow {
  kind: "add"; level: Level; parentId: string | null; depth: number;
}

type DisplayRow = (FlatRow & { kind: "item" }) | AddButtonRow;

interface DepEdge { initiativeId: string; dependsOnId: string }
interface PersonOption { id: string; name: string }

// ─── Design tokens ───────────────────────────────────

const LEVEL_COLORS: Record<Level, string> = {
  Workstream:  "#6366f1",
  Deliverable: "#f59e0b",
  Feature:     "#3b82f6",
  Task:        "#22c55e",
};

const LEVEL_BAR_HEIGHTS: Record<Level, number> = {
  Workstream: 26, Deliverable: 22, Feature: 20, Task: 18,
};

const LEVEL_BAR_RADIUS: Record<Level, number> = {
  Workstream: 5, Deliverable: 4, Feature: 4, Task: 4,
};

const STATUS_OPACITY: Record<string, number> = {
  "Not started": 0.3, NOT_STARTED: 0.3,
  "In progress": 1, IN_PROGRESS: 1,
  BLOCKED: 0.6, Done: 0.45, DONE: 0.45,
};

const LEVEL_LABELS: Record<Level, string> = {
  Workstream: "Workstream", Deliverable: "Deliverable", Feature: "Feature", Task: "Task",
};

const ROW_H = 36;
const HEADER_H = 52;
const LEFT_W = 340;
const DAY_W = 3;
const INDENT_PX = 24;
const HANDLE_W = 10;

// ─── Data helpers ────────────────────────────────────

function toDay(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return isNaN(t) ? null : Math.floor(t / 86400000);
}

function dayToIso(dayNum: number): string {
  return new Date(dayNum * 86400000).toISOString().slice(0, 10);
}

function fmtShort(dayNum: number): string {
  return new Date(dayNum * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function computeFeaturePct(init: InitiativeRow): number | null {
  if (init.subTasks.length === 0) return null;
  const total = init.subTasks.reduce((s, t) => s + (t.completionPercent ?? 0), 0);
  return Math.round(total / init.subTasks.length);
}

function collectTaskPcts(inits: InitiativeRow[]): number[] {
  const pcts: number[] = [];
  for (const init of inits) {
    for (const sub of init.subTasks) pcts.push(sub.completionPercent ?? 0);
  }
  return pcts;
}

function avgPct(pcts: number[]): number | null {
  if (pcts.length === 0) return null;
  return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
}

function buildDisplayRows(workstreams: WorkstreamRow[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  for (const ws of workstreams) {
    const c = ws.color ?? LEVEL_COLORS.Workstream;
    const allWsTaskPcts: number[] = [];
    const delRows: DisplayRow[] = [];

    for (const del of ws.deliverables) {
      const delTaskPcts = collectTaskPcts(del.initiatives);
      allWsTaskPcts.push(...delTaskPcts);
      delRows.push({ kind: "item", id: del.id, name: del.name, level: "Deliverable", status: del.status, startDate: del.startDate, endDate: del.endDate, assign: null, depth: 1, childCount: del.initiatives.length, color: LEVEL_COLORS.Deliverable, pct: avgPct(delTaskPcts), initiativeId: null });
      for (const init of del.initiatives) addInit(delRows, init, 2);
      delRows.push({ kind: "add", level: "Feature", parentId: del.id, depth: 2 });
    }
    for (const init of ws.initiatives) {
      allWsTaskPcts.push(...collectTaskPcts([init]));
      addInit(delRows, init, 1);
    }

    rows.push({ kind: "item", id: ws.id, name: ws.name, level: "Workstream", status: ws.status, startDate: ws.startDate, endDate: ws.endDate, assign: null, depth: 0, childCount: ws.deliverables.length + ws.initiatives.length, color: c, pct: avgPct(allWsTaskPcts), initiativeId: null });
    rows.push(...delRows);
    rows.push({ kind: "add", level: "Deliverable", parentId: ws.id, depth: 1 });
  }
  rows.push({ kind: "add", level: "Workstream", parentId: null, depth: 0 });
  return rows;
}

function addInit(rows: DisplayRow[], init: InitiativeRow, depth: number) {
  let featureStart = init.startDate;
  let featureEnd = init.endDate;
  for (const sub of init.subTasks) {
    if (sub.startDate) {
      if (!featureStart || sub.startDate < featureStart) featureStart = sub.startDate;
    }
    if (sub.endDate) {
      if (!featureEnd || sub.endDate > featureEnd) featureEnd = sub.endDate;
    }
  }
  rows.push({ kind: "item", id: init.id, name: init.name, level: "Feature", status: init.status, startDate: featureStart, endDate: featureEnd, assign: init.ownerInitials, depth, childCount: init.subTasks.length, color: LEVEL_COLORS.Feature, pct: computeFeaturePct(init), initiativeId: init.id });
  for (const sub of init.subTasks) {
    rows.push({ kind: "item", id: sub.id, name: sub.name, level: "Task", status: sub.status, startDate: sub.startDate, endDate: sub.endDate, assign: sub.assignee?.name ?? null, depth: depth + 1, childCount: 0, color: LEVEL_COLORS.Task, pct: sub.completionPercent ?? 0, initiativeId: init.id });
  }
  rows.push({ kind: "add", level: "Task", parentId: init.id, depth: depth + 1 });
}

function monthsBetween(startDay: number, endDay: number): { label: string; shortLabel: string; x: number; dayNum: number }[] {
  const out: { label: string; shortLabel: string; x: number; dayNum: number }[] = [];
  const d = new Date(startDay * 86400000);
  d.setDate(1);
  while (Math.floor(d.getTime() / 86400000) <= endDay) {
    const dayNum = Math.floor(d.getTime() / 86400000);
    if (dayNum >= startDay) {
      out.push({
        label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        shortLabel: d.toLocaleDateString("en-US", { month: "short" }),
        x: (dayNum - startDay) * DAY_W,
        dayNum,
      });
    }
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

function weekLinesBetween(startDay: number, endDay: number): number[] {
  const lines: number[] = [];
  const d = new Date(startDay * 86400000);
  const dow = d.getDay();
  const daysUntilMon = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  d.setDate(d.getDate() + daysUntilMon);
  while (Math.floor(d.getTime() / 86400000) <= endDay) {
    lines.push((Math.floor(d.getTime() / 86400000) - startDay) * DAY_W);
    d.setDate(d.getDate() + 7);
  }
  return lines;
}

// ─── Hierarchy edges ─────────────────────────────────

interface HierarchyEdge { parentVi: number; childVi: number }

function buildHierarchyEdges(visible: DisplayRow[]): HierarchyEdge[] {
  const edges: HierarchyEdge[] = [];
  const parentStack: { vi: number; depth: number }[] = [];
  for (let vi = 0; vi < visible.length; vi++) {
    const row = visible[vi];
    if (row.kind !== "item") continue;
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].depth >= row.depth) parentStack.pop();
    if (parentStack.length > 0) edges.push({ parentVi: parentStack[parentStack.length - 1].vi, childVi: vi });
    parentStack.push({ vi, depth: row.depth });
  }
  return edges;
}

// ─── Popover helpers ─────────────────────────────────

const TL_RISK = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Med" },
  { value: "High", label: "High" },
  { value: "Very High", label: "VH" },
];

const POP_STATUS_OPTS = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "DONE", label: "Done" },
];

function statusToForm(s: string): string {
  return ({ "Not started": "NOT_STARTED", "In progress": "IN_PROGRESS", Blocked: "BLOCKED", Done: "DONE" } as Record<string, string>)[s] ?? s;
}

function isoFromDate(d: string | null): string {
  if (!d) return "";
  const p = new Date(d);
  return isNaN(p.getTime()) ? "" : p.toISOString().slice(0, 10);
}

// ─── Context menu for quick dependency management ────

interface ContextMenuState {
  x: number; y: number;
  rowId: string; initiativeId: string;
  level: Level; name: string;
}

function BarContextMenu({ menu, dependencies, allFeatures, onClose, onRefresh }: {
  menu: ContextMenuState;
  dependencies: DepEdge[];
  allFeatures: { id: string; name: string }[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState<"main" | "add">("main");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const currentDeps = useMemo(() => dependencies.filter(d => d.initiativeId === menu.initiativeId), [dependencies, menu.initiativeId]);
  const currentDepIds = useMemo(() => new Set(currentDeps.map(d => d.dependsOnId)), [currentDeps]);
  const featureMap = useMemo(() => { const m = new Map<string, string>(); for (const f of allFeatures) m.set(f.id, f.name); return m; }, [allFeatures]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return allFeatures
      .filter(f => f.id !== menu.initiativeId && !currentDepIds.has(f.id) && (!q || f.name.toLowerCase().includes(q)))
      .slice(0, 10);
  }, [allFeatures, search, menu.initiativeId, currentDepIds]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const handleAdd = async (depId: string) => {
    setBusy(depId);
    try {
      await addDependency({ initiativeId: menu.initiativeId, dependsOnId: depId });
      onRefresh();
    } catch (err) { console.error("Add dep failed:", err); }
    finally { setBusy(null); }
  };

  const handleRemove = async (depId: string) => {
    setBusy(depId);
    try {
      await removeDependency({ initiativeId: menu.initiativeId, dependsOnId: depId });
      onRefresh();
    } catch (err) { console.error("Remove dep failed:", err); }
    finally { setBusy(null); }
  };

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(menu.x, vw - 240);
  const top = Math.min(menu.y, vh - 300);

  return (
    <>
      <div className="fixed inset-0 z-[98]" />
      <div ref={ref} className="fixed z-[100] bg-popover rounded-lg shadow-xl border border-border/50 w-[220px] overflow-hidden" style={{ top, left }}>
        <div className="px-3 py-2 border-b border-border/30">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: LEVEL_COLORS[menu.level] }} />
            <span className="text-[10px] font-semibold text-foreground truncate">{menu.name}</span>
          </div>
        </div>

        {mode === "main" ? (
          <div className="py-1">
            <button
              onClick={() => setMode("add")}
              className="w-full text-left px-3 py-1.5 text-[11px] text-foreground hover:bg-accent/40 transition-colors flex items-center gap-2"
            >
              <svg className="w-3.5 h-3.5 text-orange-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
              Add dependency…
            </button>
            {currentDeps.length > 0 && (
              <div className="border-t border-border/20 mt-1 pt-1">
                <div className="px-3 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Current dependencies</div>
                {currentDeps.map(dep => (
                  <div key={dep.dependsOnId} className="flex items-center gap-1.5 px-3 py-1 group/dep hover:bg-accent/20 transition-colors">
                    <svg className="w-3 h-3 text-orange-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
                    <span className="text-[10px] text-foreground truncate flex-1">{featureMap.get(dep.dependsOnId) ?? dep.dependsOnId}</span>
                    <button
                      onClick={() => handleRemove(dep.dependsOnId)}
                      disabled={busy === dep.dependsOnId}
                      className="w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover/dep:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all shrink-0"
                    >
                      {busy === dep.dependsOnId ? <span className="text-[8px]">…</span> : <span className="text-[10px]">✕</span>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search features…"
              className="w-full h-6 text-[10px] bg-background text-foreground border border-border/40 rounded px-2 focus:outline-none focus:ring-1 focus:ring-blue-500/40 mb-1"
              autoFocus
              onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setMode("main"); setSearch(""); } }}
            />
            <div className="max-h-[160px] overflow-y-auto">
              {filtered.map(f => (
                <button
                  key={f.id}
                  onClick={() => handleAdd(f.id)}
                  disabled={busy === f.id}
                  className="w-full text-left text-[10px] py-1 px-1.5 rounded hover:bg-accent/30 text-foreground truncate transition-colors disabled:opacity-40"
                >
                  {f.name}
                </button>
              ))}
              {filtered.length === 0 && <p className="text-[10px] text-muted-foreground/50 px-1.5 py-1">No matches</p>}
            </div>
            <button onClick={() => { setMode("main"); setSearch(""); }} className="text-[9px] text-muted-foreground hover:text-foreground mt-1 transition-colors">← Back</button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── (Add items via left panel ItemPopover) ─────────

// ─── Edit / Add popover ──────────────────────────────

type PopoverMode =
  | { kind: "edit"; item: { id: string; name: string; level: Level; status: string; startDate: string | null; endDate: string | null; initiativeId: string | null } }
  | { kind: "add"; level: Level; parentId: string | null };

// ─── Dependency section inside edit popover ──────────

function DependencySection({ initiativeId, level, dependencies, allFeatures, onChanged }: {
  initiativeId: string; level: Level; dependencies: DepEdge[];
  allFeatures: { id: string; name: string }[]; onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const currentDeps = useMemo(() => {
    return dependencies.filter(d => d.initiativeId === initiativeId);
  }, [dependencies, initiativeId]);

  const currentDepIds = useMemo(() => new Set(currentDeps.map(d => d.dependsOnId)), [currentDeps]);

  const featureMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of allFeatures) m.set(f.id, f.name);
    return m;
  }, [allFeatures]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allFeatures.filter(f => f.id !== initiativeId && !currentDepIds.has(f.id)).slice(0, 8);
    const q = search.toLowerCase();
    return allFeatures.filter(f => f.id !== initiativeId && !currentDepIds.has(f.id) && f.name.toLowerCase().includes(q)).slice(0, 8);
  }, [allFeatures, search, initiativeId, currentDepIds]);

  const handleAdd = async (depId: string) => {
    setBusy(depId);
    try {
      await addDependency({ initiativeId, dependsOnId: depId });
      setAdding(false);
      setSearch("");
      onChanged();
    } catch (err) {
      console.error("Add dep failed:", err);
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (depId: string) => {
    setBusy(depId);
    try {
      await removeDependency({ initiativeId, dependsOnId: depId });
      onChanged();
    } catch (err) {
      console.error("Remove dep failed:", err);
    } finally {
      setBusy(null);
    }
  };

  if (level !== "Feature" && level !== "Task") return null;

  return (
    <div className="pt-2 mt-2 border-t border-border/30">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">Dependencies</span>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-[9px] text-blue-500 hover:text-blue-400 font-medium transition-colors">+ Add</button>
        )}
      </div>

      {currentDeps.length === 0 && !adding && (
        <p className="text-[10px] text-muted-foreground/50 italic">No dependencies</p>
      )}

      {currentDeps.map(dep => (
        <div key={dep.dependsOnId} className="flex items-center gap-1.5 py-0.5 group/dep">
          <svg className="w-3 h-3 text-orange-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
          <span className="text-[10px] text-foreground truncate flex-1">{featureMap.get(dep.dependsOnId) ?? dep.dependsOnId}</span>
          <button
            onClick={() => handleRemove(dep.dependsOnId)}
            disabled={busy === dep.dependsOnId}
            className="w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover/dep:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-all shrink-0"
          >
            {busy === dep.dependsOnId ? <span className="text-[8px]">…</span> : <span className="text-[10px]">✕</span>}
          </button>
        </div>
      ))}

      {adding && (
        <div className="mt-1">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search features…"
            className="w-full h-6 text-[10px] bg-background text-foreground border border-border/40 rounded px-2 focus:outline-none focus:ring-1 focus:ring-blue-500/40 mb-1"
            autoFocus
            onKeyDown={e => { if (e.key === "Escape") { setAdding(false); setSearch(""); } }}
          />
          <div className="max-h-[120px] overflow-y-auto">
            {filtered.map(f => (
              <button
                key={f.id}
                onClick={() => handleAdd(f.id)}
                disabled={busy === f.id}
                className="w-full text-left text-[10px] py-1 px-1.5 rounded hover:bg-accent/30 text-foreground truncate transition-colors disabled:opacity-40"
              >
                {f.name}
              </button>
            ))}
            {filtered.length === 0 && <p className="text-[10px] text-muted-foreground/50 px-1.5 py-1">No matches</p>}
          </div>
          <button onClick={() => { setAdding(false); setSearch(""); }} className="text-[9px] text-muted-foreground hover:text-foreground mt-1 transition-colors">Cancel</button>
        </div>
      )}
    </div>
  );
}

interface ItemPopoverProps {
  mode: PopoverMode;
  anchorRect: { top: number; left: number };
  onSaved: () => void; onCancel: () => void;
  dependencies: DepEdge[];
  allFeatures: { id: string; name: string }[];
}

function ItemPopover({ mode, anchorRect, onSaved, onCancel, dependencies, allFeatures }: ItemPopoverProps) {
  const isEdit = mode.kind === "edit";
  const level = isEdit ? mode.item.level : mode.level;

  const [name, setName] = useState(isEdit ? mode.item.name : "");
  const [status, setStatus] = useState(isEdit ? statusToForm(mode.item.status) : "NOT_STARTED");
  const [startDate, setStartDate] = useState(isEdit ? isoFromDate(mode.item.startDate) : "");
  const [endDate, setEndDate] = useState(isEdit ? isoFromDate(mode.item.endDate) : "");
  const [estimatedDays, setEstimatedDays] = useState("");
  const [riskLevel, setRiskLevel] = useState("Medium");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (isEdit) nameRef.current?.select();
    else nameRef.current?.focus();
  }, [isEdit]);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = anchorRect.top;
      let left = Math.min(anchorRect.left, vw - 300);
      if (top + h > vh - 8) top = Math.max(8, anchorRect.top - h - 8);
      if (left + 280 > vw - 8) left = vw - 288;
      setPopoverPos({ top, left });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchorRect]);

  const handleSave = useCallback(async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      if (isEdit) {
        await updateRoadmapItem({
          id: mode.item.id, level: mode.item.level,
          name: name.trim(), status,
          startDate: startDate || null, endDate: endDate || null,
        });
      } else {
        const days = estimatedDays ? parseFloat(estimatedDays) : null;
        await addRoadmapItem({
          level: mode.level, name: name.trim(), parentId: mode.parentId, status,
          startDate: startDate || null, endDate: endDate || null,
          estimatedDays: mode.level === "Task" ? days : undefined,
          riskLevel: mode.level === "Task" ? riskLevel : undefined,
        });
      }
      onSaved();
    } catch (err) {
      console.error("Failed to save:", err);
      setSaving(false);
    }
  }, [isEdit, mode, name, status, startDate, endDate, estimatedDays, riskLevel, saving, onSaved]);

  const handleDelete = useCallback(async () => {
    if (!isEdit || deleting) return;
    if (!confirm(`Delete "${mode.item.name}"? This will also delete all children and archive from Notion.`)) return;
    setDeleting(true);
    try {
      await deleteRoadmapItem({ id: mode.item.id, level: mode.item.level });
      onSaved();
    } catch (err) {
      console.error("Delete failed:", err);
      setDeleting(false);
    }
  }, [isEdit, mode, deleting, onSaved]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") onCancel();
  };

  const fieldCls = "w-full h-7 text-[11px] bg-background text-foreground border border-border/40 rounded-md px-2 focus:outline-none focus:ring-1 focus:ring-blue-500/40 transition-colors";
  const labelCls = "block text-[9px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5";

  return (
    <div
      ref={popoverRef}
      className="fixed z-[100] bg-popover rounded-lg shadow-lg border border-border/50 p-4 w-[280px] max-h-[calc(100vh-16px)] overflow-y-auto"
      style={{
        top: popoverPos?.top ?? anchorRect.top,
        left: popoverPos?.left ?? Math.min(anchorRect.left, window.innerWidth - 300),
        visibility: popoverPos ? "visible" : "hidden",
      }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: LEVEL_COLORS[level] }} />
          <span className="text-[11px] font-semibold text-foreground">
            {isEdit ? "Edit" : "New"} {LEVEL_LABELS[level]}
          </span>
        </div>
        <button onClick={onCancel} className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-xs">✕</button>
      </div>

      <div className="space-y-2.5">
        <div>
          <label className={labelCls}>Name</label>
          <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)} onKeyDown={onKey} placeholder={`${LEVEL_LABELS[level]} name…`} className={fieldCls} disabled={saving} />
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className={fieldCls} disabled={saving}>
            {POP_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Start</label>
            <DatePicker value={startDate} onChange={setStartDate} onKeyDown={onKey} disabled={saving} placeholder="Start date" />
          </div>
          <div>
            <label className={labelCls}>End</label>
            <DatePicker value={endDate} onChange={setEndDate} onKeyDown={onKey} disabled={saving} placeholder="End date" />
          </div>
        </div>
        {!isEdit && level === "Task" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Est. Days</label>
              <input type="number" min={0} step="0.5" value={estimatedDays} onChange={e => setEstimatedDays(e.target.value)} onKeyDown={onKey} placeholder="e.g. 2" className={fieldCls} disabled={saving} />
            </div>
            <div>
              <label className={labelCls}>Risk</label>
              <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} className={fieldCls} disabled={saving}>
                {TL_RISK.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <button onClick={handleSave} disabled={!name.trim() || saving || deleting} className="flex-1 text-[11px] font-medium py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {saving ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save" : "Create")}
          </button>
          <button onClick={onCancel} disabled={saving || deleting} className="text-[11px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md hover:bg-accent transition-colors">
            Cancel
          </button>
        </div>
        {isEdit && (
          <DependencySection
            initiativeId={mode.item.initiativeId ?? mode.item.id}
            level={mode.item.level}
            dependencies={dependencies}
            allFeatures={allFeatures}
            onChanged={onSaved}
          />
        )}
        {isEdit && (
          <div className="pt-2 mt-2 border-t border-border/30">
            <button
              onClick={handleDelete}
              disabled={saving || deleting}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium py-1.5 rounded-md text-red-500 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
            >
              {deleting ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Resize types ────────────────────────────────────

type ResizeEdge = "left" | "right" | "move";

interface ResizeDrag {
  vi: number; id: string; level: Level; edge: ResizeEdge;
  origStartDay: number; origEndDay: number;
  anchorX: number; currentX: number;
}

// ─── Main component ──────────────────────────────────

export function RoadmapTimeline({ workstreams, dependencies = [], people = [], collapseSignal = 0 }: {
  workstreams: WorkstreamRow[]; dependencies?: DepEdge[]; people?: PersonOption[]; collapseSignal?: number;
}) {
  const allRows = useMemo(() => buildDisplayRows(workstreams), [workstreams]);
  const allFeatures = useMemo(() => {
    const features: { id: string; name: string }[] = [];
    for (const ws of workstreams) {
      for (const del of ws.deliverables) {
        for (const init of del.initiatives) features.push({ id: init.id, name: init.name });
      }
      for (const init of ws.initiatives) features.push({ id: init.id, name: init.name });
    }
    return features.sort((a, b) => a.name.localeCompare(b.name));
  }, [workstreams]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDeps, setShowDeps] = useState(true);

  const collapsibleIds = useMemo(() => allRows.filter(r => r.kind === "item" && r.childCount > 0).map(r => (r as FlatRow & { kind: "item" }).id), [allRows]);

  useEffect(() => {
    if (collapseSignal === 0) return;
    if (collapseSignal > 0) setCollapsed(new Set(collapsibleIds));
    else setCollapsed(new Set());
  }, [collapseSignal, collapsibleIds]);

  useEffect(() => {
    if (optimisticDates.size > 0) setOptimisticDates(new Map());
  }, [workstreams]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const leftRowsRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const router = useRouter();

  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);
  const [optimisticDates, setOptimisticDates] = useState<Map<string, { startDate: string; endDate: string }>>(new Map());
  const [itemPopover, setItemPopover] = useState<{
    mode: PopoverMode; anchorRect: { top: number; left: number };
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const toggle = (id: string) => {
    setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleItemPopoverSaved = useCallback(() => { setItemPopover(null); router.refresh(); }, [router]);
  const handleItemPopoverCancel = useCallback(() => { setItemPopover(null); }, []);

  const openEditPopover = useCallback((row: FlatRow & { kind: "item" }, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setItemPopover({
      mode: { kind: "edit", item: { id: row.id, name: row.name, level: row.level, status: row.status, startDate: row.startDate, endDate: row.endDate, initiativeId: row.initiativeId } },
      anchorRect: { top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 300) },
    });
  }, []);

  const openAddPopover = useCallback((level: Level, parentId: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setItemPopover({
      mode: { kind: "add", level, parentId },
      anchorRect: { top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 300) },
    });
  }, []);

  const openContextMenu = useCallback((row: FlatRow & { kind: "item" }, e: React.MouseEvent) => {
    if (row.level !== "Feature" && row.level !== "Task") return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, rowId: row.id, initiativeId: row.initiativeId ?? row.id, level: row.level, name: row.name });
  }, []);

  const handleContextMenuClose = useCallback(() => { setContextMenu(null); }, []);
  const handleContextMenuRefresh = useCallback(() => { setContextMenu(null); router.refresh(); }, [router]);

  // Sync vertical scroll between left rows and gantt panel
  const handleGanttScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (scrollRef.current && leftRowsRef.current) {
      leftRowsRef.current.scrollTop = scrollRef.current.scrollTop;
    }
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  const handleLeftRowsScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    if (scrollRef.current && leftRowsRef.current) {
      scrollRef.current.scrollTop = leftRowsRef.current.scrollTop;
    }
    requestAnimationFrame(() => { syncingRef.current = false; });
  }, []);

  const visible = useMemo(() => {
    const out: DisplayRow[] = [];
    const stack: { depth: number; id: string }[] = [];
    for (const row of allRows) {
      while (stack.length > 0 && stack[stack.length - 1].depth >= row.depth) stack.pop();
      const hidden = stack.some((a) => collapsed.has(a.id));
      if (!hidden) out.push(row);
      if (row.kind === "item") stack.push({ depth: row.depth, id: row.id });
    }
    return out;
  }, [allRows, collapsed]);

  const itemRows = useMemo(() => visible.filter((r): r is FlatRow & { kind: "item" } => r.kind === "item"), [visible]);
  const hierarchyEdges = useMemo(() => buildHierarchyEdges(visible), [visible]);

  const { minDay, maxDay } = useMemo(() => {
    let mn = Infinity, mx = -Infinity;
    for (const r of itemRows) {
      const s = toDay(r.startDate), e = toDay(r.endDate);
      if (s !== null) { mn = Math.min(mn, s); mx = Math.max(mx, s); }
      if (e !== null) { mn = Math.min(mn, e); mx = Math.max(mx, e); }
    }
    if (mn === Infinity) { const today = Math.floor(Date.now() / 86400000); mn = today - 30; mx = today + 180; }
    return { minDay: mn - 14, maxDay: mx + 30 };
  }, [itemRows]);

  const totalWidth = (maxDay - minDay) * DAY_W;
  const months = useMemo(() => monthsBetween(minDay, maxDay), [minDay, maxDay]);
  const weekLines = useMemo(() => weekLinesBetween(minDay, maxDay), [minDay, maxDay]);
  const todayX = (Math.floor(Date.now() / 86400000) - minDay) * DAY_W;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, todayX - 300);
  }, [todayX]);



  const getBarGeom = useCallback((row: FlatRow & { kind: "item" }, vi: number) => {
    const opt = optimisticDates.get(row.id);
    let sd = toDay(opt?.startDate ?? row.startDate);
    let ed = toDay(opt?.endDate ?? row.endDate);
    if (sd === null && ed === null) return null;

    if (resizeDrag && resizeDrag.vi === vi) {
      const delta = Math.round((resizeDrag.currentX - resizeDrag.anchorX) / DAY_W);
      if (resizeDrag.edge === "left") sd = resizeDrag.origStartDay + delta;
      else if (resizeDrag.edge === "right") ed = resizeDrag.origEndDay + delta;
      else { sd = resizeDrag.origStartDay + delta; ed = resizeDrag.origEndDay + delta; }
    }

    const startX = sd !== null ? (sd - minDay) * DAY_W : (ed! - minDay) * DAY_W - 20;
    const endX = ed !== null ? (ed - minDay) * DAY_W : (sd! - minDay) * DAY_W + 20;
    const barW = Math.max(endX - startX, 4);
    const barH = LEVEL_BAR_HEIGHTS[row.level];
    const y = HEADER_H + vi * ROW_H + (ROW_H - barH) / 2;
    return { startX, endX, barW, barH, y, sd, ed };
  }, [minDay, resizeDrag, optimisticDates]);

  // ─── Mouse handlers ─────────────────────────────────

  const getMousePos = useCallback((e: React.MouseEvent) => {
    const gantt = ganttRef.current;
    if (!gantt) return { x: 0, y: 0 };
    const rect = gantt.getBoundingClientRect();
    const scrollL = gantt.parentElement?.scrollLeft ?? 0;
    const scrollT = gantt.parentElement?.scrollTop ?? 0;
    return { x: e.clientX - rect.left + scrollL, y: e.clientY - rect.top + scrollT };
  }, []);

  const handleGanttMouseDown = useCallback((e: React.MouseEvent) => {
    const { x, y } = getMousePos(e);
    const rowIdx = Math.floor((y - HEADER_H) / ROW_H);
    if (rowIdx < 0 || rowIdx >= visible.length) return;
    const row = visible[rowIdx];

    if (row.kind === "item") {
      setSelectedId(row.id);
      const geom = getBarGeom(row, rowIdx);
      if (geom) {
        const { startX, endX, barW, sd, ed } = geom;
        if (sd !== null && ed !== null) {
          const resizeZone = Math.min(HANDLE_W, barW * 0.25);
          if (x >= startX - HANDLE_W && x <= startX + resizeZone) {
            e.preventDefault();
            setResizeDrag({ vi: rowIdx, id: row.id, level: row.level, edge: "left", origStartDay: sd, origEndDay: ed, anchorX: x, currentX: x });
            return;
          }
          if (x >= endX - resizeZone && x <= endX + HANDLE_W) {
            e.preventDefault();
            setResizeDrag({ vi: rowIdx, id: row.id, level: row.level, edge: "right", origStartDay: sd, origEndDay: ed, anchorX: x, currentX: x });
            return;
          }
          if (x > startX - HANDLE_W && x < endX + HANDLE_W) {
            e.preventDefault();
            setResizeDrag({ vi: rowIdx, id: row.id, level: row.level, edge: "move", origStartDay: sd, origEndDay: ed, anchorX: x, currentX: x });
            return;
          }
        } else if (sd !== null) {
          // Only start date — allow drag-move from the bar
          const fakeEnd = sd + 1;
          if (x >= startX - HANDLE_W && x <= endX + HANDLE_W) {
            e.preventDefault();
            setResizeDrag({ vi: rowIdx, id: row.id, level: row.level, edge: "right", origStartDay: sd, origEndDay: fakeEnd, anchorX: x, currentX: x });
            return;
          }
        } else if (ed !== null) {
          // Only end date — allow drag-move from the bar
          const fakeStart = ed - 1;
          if (x >= startX - HANDLE_W && x <= endX + HANDLE_W) {
            e.preventDefault();
            setResizeDrag({ vi: rowIdx, id: row.id, level: row.level, edge: "left", origStartDay: fakeStart, origEndDay: ed, anchorX: x, currentX: x });
            return;
          }
        }
      }
      // No bar at all — click to create a new 7-day bar centered on click position
      if (!geom) {
        e.preventDefault();
        const clickDay = Math.round(x / DAY_W) + minDay;
        const newStart = clickDay - 3;
        const newEnd = clickDay + 4;
        const startIso = dayToIso(newStart), endIso = dayToIso(newEnd);
        setOptimisticDates(prev => {
          const next = new Map(prev);
          next.set(row.id, { startDate: startIso, endDate: endIso });
          return next;
        });
        setResizeDrag({ vi: rowIdx, id: row.id, level: row.level, edge: "right", origStartDay: newStart, origEndDay: newEnd, anchorX: x, currentX: x });
      }
    }

  }, [visible, getMousePos, getBarGeom, minDay]);

  const handleGanttMouseMove = useCallback((e: React.MouseEvent) => {
    const { x } = getMousePos(e);
    if (resizeDrag) { setResizeDrag(prev => prev ? { ...prev, currentX: x } : null); return; }
  }, [resizeDrag, getMousePos]);

  const handleGanttMouseUp = useCallback(async () => {
    if (resizeDrag) {
      const delta = Math.round((resizeDrag.currentX - resizeDrag.anchorX) / DAY_W);
      if (Math.abs(delta) >= 1) {
        let newStart = resizeDrag.origStartDay, newEnd = resizeDrag.origEndDay;
        if (resizeDrag.edge === "left") newStart += delta;
        else if (resizeDrag.edge === "right") newEnd += delta;
        else { newStart += delta; newEnd += delta; }
        if (newStart > newEnd) [newStart, newEnd] = [newEnd, newStart];
        const startIso = dayToIso(newStart), endIso = dayToIso(newEnd);
        setOptimisticDates(prev => {
          const next = new Map(prev);
          next.set(resizeDrag.id, { startDate: startIso, endDate: endIso });
          return next;
        });
        setResizeDrag(null);
        try {
          await updateRoadmapDates({ id: resizeDrag.id, level: resizeDrag.level, startDate: startIso, endDate: endIso });
          router.refresh();
        } catch (err) { console.error("Failed to update dates:", err); }
      } else {
        setResizeDrag(null);
      }
    }
  }, [resizeDrag, router]);

  const handleGanttMouseLeave = useCallback(() => {}, []);

  if (itemRows.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        No roadmap data. Pull from Notion to get started.
      </div>
    );
  }

  // Add items via left panel buttons (ItemPopover)

  // Resize label
  const resizeLabel = (() => {
    if (!resizeDrag) return null;
    const delta = Math.round((resizeDrag.currentX - resizeDrag.anchorX) / DAY_W);
    let sd = resizeDrag.origStartDay, ed = resizeDrag.origEndDay;
    if (resizeDrag.edge === "left") sd += delta;
    else if (resizeDrag.edge === "right") ed += delta;
    else { sd += delta; ed += delta; }
    if (sd > ed) [sd, ed] = [ed, sd];
    const row = visible[resizeDrag.vi];
    if (row.kind !== "item") return null;
    const barH = LEVEL_BAR_HEIGHTS[row.level];
    const y = HEADER_H + resizeDrag.vi * ROW_H + (ROW_H - barH) / 2 - 18;
    const leftX = (sd - minDay) * DAY_W;
    return { x: leftX, y, label: `${fmtShort(sd)} — ${fmtShort(ed)}` };
  })();

  const contentH = visible.length * ROW_H;
  const svgH = HEADER_H + contentH;

  return (
    <div className="border border-border/30 rounded-xl overflow-hidden bg-card flex" style={{ height: `${Math.min(contentH + HEADER_H, 760)}px` }}>

      {/* ── Left hierarchy panel ── */}
      <div
        ref={leftRef}
        className="shrink-0 border-r border-border/20 flex flex-col"
        style={{ width: LEFT_W }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 bg-card border-b border-border/20 px-4 flex items-center justify-between shrink-0"
          style={{ height: HEADER_H }}
        >
          <span className="text-[11px] text-muted-foreground font-medium tracking-wide">Name</span>
          {dependencies.length > 0 && (
            <button
              onClick={() => setShowDeps(d => !d)}
              className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md transition-colors ${
                showDeps
                  ? "bg-orange-500/10 text-orange-500"
                  : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30"
              }`}
              title={showDeps ? "Hide dependencies" : "Show dependencies"}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
              Deps
            </button>
          )}
        </div>

        {/* Rows */}
        <div ref={leftRowsRef} className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none" onScroll={handleLeftRowsScroll}>
          {visible.map((row, vi) => {
            if (row.kind === "add") {
              return (
                <div
                  key={`add-${row.level}:${row.parentId ?? "root"}`}
                  className="flex items-center transition-colors hover:bg-accent/5"
                  style={{ height: ROW_H, paddingLeft: `${16 + row.depth * INDENT_PX + INDENT_PX}px` }}
                >
                  <button
                    onClick={(e) => openAddPopover(row.level, row.parentId, e)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-blue-500 transition-colors group/add"
                  >
                    <svg className="w-3 h-3 opacity-60 group-hover/add:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                    <span className="opacity-0 group-hover/add:opacity-100 transition-opacity">{LEVEL_LABELS[row.level]}</span>
                  </button>
                </div>
              );
            }

            const hasKids = row.childCount > 0;
            const isCollapsed = collapsed.has(row.id);
            const isWs = row.level === "Workstream";
            const isDel = row.level === "Deliverable";
            const isFeat = row.level === "Feature";
            const isSelected = selectedId === row.id;
            const isEditing = itemPopover?.mode.kind === "edit" && itemPopover.mode.item.id === row.id;

            return (
              <div
                key={row.id}
                className={`group/row flex items-center transition-colors cursor-default
                  ${isSelected ? "bg-blue-500/[0.06]" : ""}
                  ${isEditing ? "bg-blue-500/[0.08]" : ""}
                  ${!isSelected && !isEditing ? "hover:bg-accent/[0.04]" : ""}
                `}
                style={{ height: ROW_H, paddingLeft: `${16 + row.depth * INDENT_PX}px` }}
                onClick={() => setSelectedId(row.id)}
                onContextMenu={(e) => openContextMenu(row, e)}
              >
                {/* Expand/collapse or level indicator */}
                {hasKids ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(row.id); }}
                    className="w-5 h-5 flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-accent/40 rounded shrink-0 mr-2 transition-colors"
                  >
                    <svg className={`w-3 h-3 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                ) : (
                  <span className="w-5 mr-2 shrink-0 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: row.color, opacity: 0.5 }} />
                  </span>
                )}

                {/* Name */}
                <span
                  className={`truncate flex-1 min-w-0 leading-none
                    ${isWs ? "text-[13px] font-semibold text-foreground" : ""}
                    ${isDel ? "text-[12px] font-medium text-foreground/90" : ""}
                    ${isFeat ? "text-[12px] text-foreground/80" : ""}
                    ${row.level === "Task" ? "text-[11px] text-foreground/60" : ""}
                  `}
                  title={row.name}
                >
                  {row.name}
                </span>

                {/* Assignee */}
                {row.assign && (
                  <span className="text-[9px] text-muted-foreground/40 ml-2 shrink-0 font-medium tracking-wide">{row.assign}</span>
                )}

                {/* Edit button */}
                <button
                  onClick={(e) => openEditPopover(row, e)}
                  className="w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover/row:opacity-100 hover:bg-accent/40 text-muted-foreground/40 hover:text-foreground transition-all shrink-0 ml-1"
                  title="Edit"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right scrollable Gantt ── */}
      <div className="flex-1 overflow-auto" ref={scrollRef} onScroll={handleGanttScroll}>
        <div
          ref={ganttRef}
          style={{ width: totalWidth, minHeight: "100%", cursor: resizeDrag ? (resizeDrag.edge === "move" ? "grabbing" : "col-resize") : undefined }}
          className="relative select-none"
          onMouseDown={handleGanttMouseDown}
          onMouseMove={handleGanttMouseMove}
          onMouseUp={handleGanttMouseUp}
          onMouseLeave={handleGanttMouseLeave}
        >
          {/* ── Header: months ── */}
          <div className="sticky top-0 z-10 border-b border-border/20 bg-card" style={{ height: HEADER_H, width: totalWidth }}>
            {/* Month labels */}
            {months.map((m, i) => {
              const nextX = i < months.length - 1 ? months[i + 1].x : totalWidth;
              const width = nextX - m.x;
              return (
                <div
                  key={i}
                  className="absolute flex items-end pb-2 pl-3"
                  style={{ left: m.x, width, height: HEADER_H }}
                >
                  <span className="text-[11px] font-medium text-muted-foreground/70 leading-none">{m.label}</span>
                </div>
              );
            })}
            {/* Month dividers in header */}
            {months.map((m, i) => i > 0 && (
              <div key={`hd-${i}`} className="absolute top-3 bottom-0 w-px bg-border/15" style={{ left: m.x }} />
            ))}
          </div>

          {/* ── Grid: month + week lines ── */}
          {months.map((m, i) => i > 0 && (
            <div key={`ml-${i}`} className="absolute bottom-0 w-px bg-border/10" style={{ left: m.x, top: HEADER_H }} />
          ))}
          {weekLines.map((wx, i) => (
            <div key={`wl-${i}`} className="absolute bottom-0 w-px bg-border/[0.04]" style={{ left: wx, top: HEADER_H }} />
          ))}

          {/* ── Row backgrounds + dividers ── */}
          {visible.map((row, vi) => {
            const isSelected = row.kind === "item" && selectedId === row.id;
            const isWs = row.kind === "item" && row.level === "Workstream";
            return (
              <div
                key={`bg-${vi}`}
                className={`absolute left-0 right-0 border-b transition-colors
                  ${isSelected ? "bg-blue-500/[0.04] border-border/10" : ""}
                  ${isWs ? "bg-muted/[0.04] border-border/10" : "border-border/[0.04]"}
                `}
                style={{ top: HEADER_H + vi * ROW_H, height: ROW_H }}
              />
            );
          })}

          {/* ── Today indicator ── */}
          <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: todayX }}>
            <div className="absolute top-0 bottom-0 w-px bg-blue-500/30" />
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[8px] px-2 py-[3px] rounded-full font-semibold tracking-wide whitespace-nowrap">
              Today
            </div>
          </div>

          {/* ── SVG: hierarchy lines (behind bars) ── */}
          <svg className="absolute top-0 left-0 pointer-events-none z-[1]" width={totalWidth} height={svgH}>
            {hierarchyEdges.map((edge) => {
              const parentRow = visible[edge.parentVi];
              const childRow = visible[edge.childVi];
              if (parentRow.kind !== "item" || childRow.kind !== "item") return null;

              const pGeom = getBarGeom(parentRow, edge.parentVi);
              const cGeom = getBarGeom(childRow, edge.childVi);
              const parentMidY = HEADER_H + edge.parentVi * ROW_H + ROW_H / 2;
              const childMidY = HEADER_H + edge.childVi * ROW_H + ROW_H / 2;

              let anchorX: number;
              if (pGeom) anchorX = pGeom.startX;
              else if (cGeom) anchorX = cGeom.startX - 12;
              else anchorX = 20;

              return (
                <g key={`h-${edge.parentVi}-${edge.childVi}`} opacity={0.15}>
                  <line x1={anchorX - 4} y1={parentMidY} x2={anchorX - 4} y2={childMidY} stroke="currentColor" strokeWidth={1} />
                  <line x1={anchorX - 4} y1={childMidY} x2={anchorX + 6} y2={childMidY} stroke="currentColor" strokeWidth={1} />
                </g>
              );
            })}
          </svg>

          {/* ── Bars ── */}
          {visible.map((row, vi) => {
            if (row.kind !== "item") return null;
            const geom = getBarGeom(row, vi);
            if (!geom) return null;

            const { startX, barW, barH, y } = geom;
            const opacity = STATUS_OPACITY[row.status] ?? 0.8;
            const isResizing = resizeDrag?.vi === vi;
            const isSelected = selectedId === row.id;
            const isMilestone = barW < 8;
            const radius = LEVEL_BAR_RADIUS[row.level];
            const fitsLabel = barW > 50;
            const pct = row.pct;
            const pctFill = pct !== null && pct > 0 ? Math.min(pct, 100) : 0;

            return (
              <div
                key={row.id}
                className="absolute group/bar"
                style={{ left: startX, top: y, width: Math.max(barW, 6), height: barH }}
                onContextMenu={(e) => openContextMenu(row, e)}
              >
                {isMilestone ? (
                  <>
                    <div
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 transition-shadow"
                      style={{
                        width: barH + 2, height: barH + 2,
                        backgroundColor: row.color,
                        opacity: isResizing ? 0.9 : opacity,
                        cursor: "grab",
                        boxShadow: isSelected ? `0 0 0 2px ${row.color}40` : undefined,
                      }}
                      title={`${row.name}\n${row.startDate ?? "?"} → ${row.endDate ?? "?"}`}
                    />
                    <span
                      className="absolute top-1/2 -translate-y-1/2 text-[9px] font-medium whitespace-nowrap pointer-events-none"
                      style={{ left: barH + 8, color: row.color, opacity: Math.max(opacity, 0.6) }}
                    >
                      {row.name}{pct !== null ? ` ${pct}%` : ""}
                    </span>
                  </>
                ) : (
                  <div
                    className="w-full h-full relative overflow-hidden transition-all"
                    style={{
                      backgroundColor: `${row.color}${Math.round(opacity * 0.25 * 255).toString(16).padStart(2, "0")}`,
                      cursor: "grab",
                      borderRadius: radius,
                      border: `1px solid ${row.color}${Math.round(opacity * 0.5 * 255).toString(16).padStart(2, "0")}`,
                      boxShadow: isSelected ? `0 0 0 1.5px ${row.color}60` : undefined,
                    }}
                    title={`${row.name}${pct !== null ? ` (${pct}%)` : ""}\n${row.startDate ?? "?"} → ${row.endDate ?? "?"}`}
                  >
                    {/* Progress fill */}
                    {pctFill > 0 && (
                      <div
                        className="absolute inset-y-0 left-0"
                        style={{
                          width: `${pctFill}%`,
                          backgroundColor: row.color,
                          opacity: opacity * 0.6,
                          borderRadius: radius,
                        }}
                      />
                    )}
                    {/* Name label inside bar */}
                    {fitsLabel && (
                      <span
                        className="absolute inset-0 flex items-center px-1.5 text-[9px] font-medium truncate pointer-events-none z-[1]"
                        style={{ color: "white", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
                      >
                        {row.name}
                        {pct !== null && (
                          <span className="ml-1 opacity-70">{pct}%</span>
                        )}
                      </span>
                    )}
                  </div>
                )}
                {/* Name + pct label to the right of bar when it doesn't fit inside */}
                {!isMilestone && !fitsLabel && (
                  <span
                    className="absolute left-full top-1/2 -translate-y-1/2 ml-1.5 text-[9px] font-medium whitespace-nowrap pointer-events-none"
                    style={{ color: row.color, opacity: Math.max(opacity, 0.6) }}
                  >
                    {row.name}{pct !== null ? ` ${pct}%` : ""}
                  </span>
                )}
                {/* Resize handles — wide grab zones with visible pill indicators */}
                {!isMilestone && (
                  <>
                    <div
                      className="absolute top-0 h-full opacity-0 group-hover/bar:opacity-100 transition-opacity z-[2]"
                      style={{ left: -HANDLE_W / 2, width: HANDLE_W, cursor: "col-resize" }}
                    >
                      <div className="w-[3px] h-3/5 bg-white/80 rounded-full mx-auto mt-[20%]" />
                    </div>
                    <div
                      className="absolute top-0 h-full opacity-0 group-hover/bar:opacity-100 transition-opacity z-[2]"
                      style={{ right: -HANDLE_W / 2, width: HANDLE_W, cursor: "col-resize" }}
                    >
                      <div className="w-[3px] h-3/5 bg-white/80 rounded-full mx-auto mt-[20%]" />
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* ── SVG: dependency arrows (on top of bars) ── */}
          {showDeps && dependencies.length > 0 && (
            <svg className="absolute top-0 left-0 pointer-events-none z-[10]" width={totalWidth} height={svgH}>
              <defs>
                <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316" fillOpacity={0.7} />
                </marker>
              </defs>
              {(() => {
                // Map initiativeId → first visible row index for that feature
                const initViMap = new Map<string, number>();
                visible.forEach((r, i) => {
                  if (r.kind !== "item") return;
                  const iid = r.initiativeId ?? r.id;
                  if (!initViMap.has(iid)) initViMap.set(iid, i);
                });

                return dependencies.map((dep) => {
                  const fromVi = initViMap.get(dep.dependsOnId);
                  const toVi = initViMap.get(dep.initiativeId);
                  if (fromVi === undefined || toVi === undefined) return null;
                  const fromRow = visible[fromVi];
                  const toRow = visible[toVi];
                  if (fromRow.kind !== "item" || toRow.kind !== "item") return null;

                  const fromGeom = getBarGeom(fromRow, fromVi);
                  const toGeom = getBarGeom(toRow, toVi);

                  const fromY = HEADER_H + fromVi * ROW_H + ROW_H / 2;
                  const toY = HEADER_H + toVi * ROW_H + ROW_H / 2;

                  const fromEndX = fromGeom ? fromGeom.endX : 40;
                  const toStartX = toGeom ? toGeom.startX : 40;
                  const dx = toStartX - fromEndX;

                  if (Math.abs(toY - fromY) < 4) {
                    return <line key={`dep-${dep.dependsOnId}-${dep.initiativeId}`} x1={fromEndX + 2} y1={fromY} x2={toStartX - 2} y2={toY} stroke="#f97316" strokeWidth={1.5} strokeOpacity={0.7} markerEnd="url(#dep-arrow)" />;
                  }
                  const cx1 = fromEndX + Math.max(dx * 0.3, 20);
                  const cx2 = toStartX - Math.max(dx * 0.3, 20);
                  return <path key={`dep-${dep.dependsOnId}-${dep.initiativeId}`} d={`M ${fromEndX + 2} ${fromY} C ${cx1} ${fromY}, ${cx2} ${toY}, ${toStartX - 2} ${toY}`} fill="none" stroke="#f97316" strokeWidth={1.5} strokeOpacity={0.7} markerEnd="url(#dep-arrow)" />;
                });
              })()}
            </svg>
          )}

          {/* ── Resize date label ── */}
          {resizeLabel && (
            <div
              className="absolute pointer-events-none z-30 text-[9px] font-medium text-blue-400 bg-popover border border-border/30 px-2 py-0.5 rounded shadow-sm whitespace-nowrap"
              style={{ left: resizeLabel.x, top: resizeLabel.y }}
            >
              {resizeLabel.label}
            </div>
          )}

          {/* Add items via left panel buttons */}
        </div>
      </div>

      {/* ── Item popover (fixed) ── */}
      {itemPopover && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={handleItemPopoverCancel} />
          <ItemPopover
            mode={itemPopover.mode}
            anchorRect={itemPopover.anchorRect}
            onSaved={handleItemPopoverSaved}
            onCancel={handleItemPopoverCancel}
            dependencies={dependencies}
            allFeatures={allFeatures}
          />
        </>
      )}

      {contextMenu && (
        <BarContextMenu
          menu={contextMenu}
          dependencies={dependencies}
          allFeatures={allFeatures}
          onClose={handleContextMenuClose}
          onRefresh={handleContextMenuRefresh}
        />
      )}
    </div>
  );
}

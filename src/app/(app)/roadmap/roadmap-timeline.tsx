"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { addRoadmapItem } from "@/lib/actions/add-roadmap-item";
import { updateRoadmapDates, updateRoadmapItem } from "@/lib/actions/update-roadmap-dates";

// ─── Types ───────────────────────────────────────────

interface PersonRef { id: string; name: string; initials: string | null }

interface SubTaskRow {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
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
  color: string;
}

interface AddButtonRow {
  kind: "add"; level: Level; parentId: string | null; depth: number;
}

type DisplayRow = (FlatRow & { kind: "item" }) | AddButtonRow;

interface DepEdge { initiativeId: string; dependsOnId: string }
interface PersonOption { id: string; name: string }

const LEVEL_COLORS: Record<Level, string> = {
  Workstream:  "#64748b",
  Deliverable: "#e67e22",
  Feature:     "#3b82f6",
  Task:        "#22c55e",
};

const STATUS_OPACITY: Record<string, number> = {
  "Not started": 0.4, NOT_STARTED: 0.4,
  "In progress": 1, IN_PROGRESS: 1,
  BLOCKED: 0.7, Done: 0.6, DONE: 0.6,
};

const LEVEL_LABELS: Record<Level, string> = {
  Workstream: "Workstream", Deliverable: "Deliverable", Feature: "Feature", Task: "Task",
};

const ROW_H = 32;
const LEFT_W = 360;
const DAY_W = 3;

function toDay(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return isNaN(t) ? null : Math.floor(t / 86400000);
}

function buildDisplayRows(workstreams: WorkstreamRow[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  for (const ws of workstreams) {
    const c = ws.color ?? LEVEL_COLORS.Workstream;
    rows.push({ kind: "item", id: ws.id, name: ws.name, level: "Workstream", status: ws.status, startDate: ws.startDate, endDate: ws.endDate, assign: null, depth: 0, childCount: ws.deliverables.length + ws.initiatives.length, color: c });
    for (const del of ws.deliverables) {
      rows.push({ kind: "item", id: del.id, name: del.name, level: "Deliverable", status: del.status, startDate: del.startDate, endDate: del.endDate, assign: null, depth: 1, childCount: del.initiatives.length, color: LEVEL_COLORS.Deliverable });
      for (const init of del.initiatives) addInit(rows, init, 2);
      rows.push({ kind: "add", level: "Feature", parentId: del.id, depth: 2 });
    }
    for (const init of ws.initiatives) addInit(rows, init, 1);
    rows.push({ kind: "add", level: "Deliverable", parentId: ws.id, depth: 1 });
  }
  rows.push({ kind: "add", level: "Workstream", parentId: null, depth: 0 });
  return rows;
}

function addInit(rows: DisplayRow[], init: InitiativeRow, depth: number) {
  rows.push({ kind: "item", id: init.id, name: init.name, level: "Feature", status: init.status, startDate: init.startDate, endDate: init.endDate, assign: init.ownerInitials, depth, childCount: init.subTasks.length, color: LEVEL_COLORS.Feature });
  for (const sub of init.subTasks) {
    rows.push({ kind: "item", id: sub.id, name: sub.name, level: "Task", status: sub.status, startDate: sub.startDate, endDate: sub.endDate, assign: sub.assignee?.name ?? null, depth: depth + 1, childCount: 0, color: LEVEL_COLORS.Task });
  }
  rows.push({ kind: "add", level: "Task", parentId: init.id, depth: depth + 1 });
}

function monthsBetween(startDay: number, endDay: number): { label: string; x: number }[] {
  const out: { label: string; x: number }[] = [];
  const d = new Date(startDay * 86400000);
  d.setDate(1);
  while (Math.floor(d.getTime() / 86400000) <= endDay) {
    const dayNum = Math.floor(d.getTime() / 86400000);
    if (dayNum >= startDay) {
      out.push({ label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), x: (dayNum - startDay) * DAY_W });
    }
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────

const TL_RISK = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Med" },
  { value: "High", label: "High" },
  { value: "Very High", label: "VH" },
];

function dayToIso(dayNum: number): string {
  return new Date(dayNum * 86400000).toISOString().slice(0, 10);
}

function fmtShort(dayNum: number): string {
  return new Date(dayNum * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Popover form shown after drag-to-insert ─────────

interface DragPopoverProps {
  level: Level;
  parentId: string | null;
  startDay: number;
  endDay: number;
  top: number;
  left: number;
  onSaved: () => void;
  onCancel: () => void;
}

function DragInsertPopover({ level, parentId, startDay, endDay, top, left, onSaved, onCancel }: DragPopoverProps) {
  const [name, setName] = useState("");
  const [estimatedDays, setEstimatedDays] = useState("");
  const [riskLevel, setRiskLevel] = useState("Medium");
  const [status, setStatus] = useState("NOT_STARTED");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const days = estimatedDays ? parseFloat(estimatedDays) : null;
      await addRoadmapItem({
        level,
        name: trimmed,
        parentId,
        status,
        startDate: dayToIso(startDay),
        endDate: dayToIso(endDay),
        estimatedDays: level === "Task" ? days : undefined,
        riskLevel: level === "Task" ? riskLevel : undefined,
      });
      onSaved();
    } catch (err) {
      console.error("Failed to add item:", err);
      setSaving(false);
    }
  }, [name, estimatedDays, riskLevel, status, level, parentId, startDay, endDay, saving, onSaved]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") onCancel();
  };

  const fieldCls = "w-full h-7 text-[11px] bg-white border border-border rounded px-2 focus:outline-none focus:ring-1 focus:ring-blue-400";
  const labelCls = "block text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5";

  return (
    <div
      className="absolute z-50 bg-white rounded-lg shadow-xl border border-border p-3 w-[260px]"
      style={{ top, left: Math.max(4, left) }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">New {LEVEL_LABELS[level]}</span>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="text-[10px] text-muted-foreground mb-2">
        {fmtShort(startDay)} → {fmtShort(endDay)}
      </div>

      <div className="space-y-2">
        <div>
          <label className={labelCls}>Name *</label>
          <input ref={inputRef} type="text" value={name} onChange={e => setName(e.target.value)} onKeyDown={onKey} placeholder={`${LEVEL_LABELS[level]} name…`} className={fieldCls} disabled={saving} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={fieldCls} disabled={saving}>
              <option value="NOT_STARTED">Not started</option>
              <option value="IN_PROGRESS">In progress</option>
            </select>
          </div>
          {level === "Task" && (
            <div>
              <label className={labelCls}>Est. Days</label>
              <input type="number" min={0} step="0.5" value={estimatedDays} onChange={e => setEstimatedDays(e.target.value)} onKeyDown={onKey} placeholder="e.g. 2" className={fieldCls} disabled={saving} />
            </div>
          )}
        </div>

        {level === "Task" && (
          <div>
            <label className={labelCls}>Risk Level</label>
            <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} className={fieldCls} disabled={saving}>
              {TL_RISK.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button onClick={handleSave} disabled={!name.trim() || saving} className="flex-1 text-[11px] font-medium py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {saving ? "Creating…" : "Create"}
          </button>
          <button onClick={onCancel} disabled={saving} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Unified Popover (add + edit) ────────────────────

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

type PopoverMode =
  | { kind: "edit"; item: { id: string; name: string; level: Level; status: string; startDate: string | null; endDate: string | null } }
  | { kind: "add"; level: Level; parentId: string | null };

interface ItemPopoverProps {
  mode: PopoverMode;
  anchorRect: { top: number; left: number };
  onSaved: () => void;
  onCancel: () => void;
}

function ItemPopover({ mode, anchorRect, onSaved, onCancel }: ItemPopoverProps) {
  const isEdit = mode.kind === "edit";
  const level = isEdit ? mode.item.level : mode.level;

  const [name, setName] = useState(isEdit ? mode.item.name : "");
  const [status, setStatus] = useState(isEdit ? statusToForm(mode.item.status) : "NOT_STARTED");
  const [startDate, setStartDate] = useState(isEdit ? isoFromDate(mode.item.startDate) : "");
  const [endDate, setEndDate] = useState(isEdit ? isoFromDate(mode.item.endDate) : "");
  const [estimatedDays, setEstimatedDays] = useState("");
  const [riskLevel, setRiskLevel] = useState("Medium");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEdit) nameRef.current?.select();
    else nameRef.current?.focus();
  }, [isEdit]);

  const handleSave = useCallback(async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      if (isEdit) {
        await updateRoadmapItem({
          id: mode.item.id,
          level: mode.item.level,
          name: name.trim(),
          status,
          startDate: startDate || null,
          endDate: endDate || null,
        });
      } else {
        const days = estimatedDays ? parseFloat(estimatedDays) : null;
        await addRoadmapItem({
          level: mode.level,
          name: name.trim(),
          parentId: mode.parentId,
          status,
          startDate: startDate || null,
          endDate: endDate || null,
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

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") onCancel();
  };

  const fieldCls = "w-full h-7 text-[11px] bg-white border border-border rounded px-2 focus:outline-none focus:ring-1 focus:ring-blue-400";
  const labelCls = "block text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5";

  return (
    <div
      className="fixed z-[100] bg-white rounded-lg shadow-xl border border-border p-3 w-[280px]"
      style={{ top: anchorRect.top, left: Math.min(anchorRect.left, window.innerWidth - 300) }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          {isEdit ? "Edit" : "New"} {LEVEL_LABELS[level]}
        </span>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="space-y-2">
        <div>
          <label className={labelCls}>Name *</label>
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
            <label className={labelCls}>Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} onKeyDown={onKey} className={fieldCls} disabled={saving} />
          </div>
          <div>
            <label className={labelCls}>End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} onKeyDown={onKey} className={fieldCls} disabled={saving} />
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
          <button onClick={handleSave} disabled={!name.trim() || saving} className="flex-1 text-[11px] font-medium py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {saving ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save" : "Create")}
          </button>
          <button onClick={onCancel} disabled={saving} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1.5">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Resize helpers ──────────────────────────────────

type ResizeEdge = "left" | "right" | "move";

interface ResizeDrag {
  vi: number;
  id: string;
  level: Level;
  edge: ResizeEdge;
  origStartDay: number;
  origEndDay: number;
  anchorX: number;
  currentX: number;
}

const HANDLE_W = 6;

// ─── Build hierarchy edges for tree connector lines ──

interface HierarchyEdge { parentVi: number; childVi: number }

function buildHierarchyEdges(visible: DisplayRow[]): HierarchyEdge[] {
  const edges: HierarchyEdge[] = [];
  const parentStack: { vi: number; depth: number }[] = [];

  for (let vi = 0; vi < visible.length; vi++) {
    const row = visible[vi];
    if (row.kind !== "item") continue;

    while (parentStack.length > 0 && parentStack[parentStack.length - 1].depth >= row.depth) {
      parentStack.pop();
    }

    if (parentStack.length > 0) {
      edges.push({ parentVi: parentStack[parentStack.length - 1].vi, childVi: vi });
    }

    parentStack.push({ vi, depth: row.depth });
  }

  return edges;
}

// ─── Component ───────────────────────────────────────

export function RoadmapTimeline({ workstreams, dependencies = [], people = [], collapseSignal = 0 }: {
  workstreams: WorkstreamRow[]; dependencies?: DepEdge[]; people?: PersonOption[]; collapseSignal?: number;
}) {
  const allRows = useMemo(() => buildDisplayRows(workstreams), [workstreams]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const collapsibleIds = useMemo(() => allRows.filter(r => r.kind === "item" && r.childCount > 0).map(r => (r as FlatRow & { kind: "item" }).id), [allRows]);

  useEffect(() => {
    if (collapseSignal === 0) return;
    if (collapseSignal > 0) setCollapsed(new Set(collapsibleIds));
    else setCollapsed(new Set());
  }, [collapseSignal, collapsibleIds]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Drag-to-insert state
  const [insertDrag, setInsertDrag] = useState<{
    vi: number; level: Level; parentId: string | null;
    startX: number; currentX: number; active: boolean;
  } | null>(null);
  const [popover, setPopover] = useState<{
    vi: number; level: Level; parentId: string | null;
    startDay: number; endDay: number; top: number; left: number;
  } | null>(null);
  const [hoverVi, setHoverVi] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  // Resize-existing-bar state
  const [resizeDrag, setResizeDrag] = useState<ResizeDrag | null>(null);

  // Unified popover state (for edit items and add-via-click)
  const [itemPopover, setItemPopover] = useState<{
    mode: PopoverMode;
    anchorRect: { top: number; left: number };
  } | null>(null);

  const toggle = (id: string) => {
    setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleSaved = useCallback(() => { setPopover(null); router.refresh(); }, [router]);
  const handleCancel = useCallback(() => { setPopover(null); }, []);
  const handleItemPopoverSaved = useCallback(() => { setItemPopover(null); router.refresh(); }, [router]);
  const handleItemPopoverCancel = useCallback(() => { setItemPopover(null); }, []);

  const openEditPopover = useCallback((row: FlatRow & { kind: "item" }, e: React.MouseEvent) => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    setItemPopover({
      mode: { kind: "edit", item: { id: row.id, name: row.name, level: row.level, status: row.status, startDate: row.startDate, endDate: row.endDate } },
      anchorRect: { top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 300) },
    });
  }, []);

  const openAddPopover = useCallback((level: Level, parentId: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    setItemPopover({
      mode: { kind: "add", level, parentId },
      anchorRect: { top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 300) },
    });
  }, []);

  const visible = useMemo(() => {
    const out: DisplayRow[] = [];
    const stack: { depth: number; id: string }[] = [];
    for (const row of allRows) {
      while (stack.length > 0 && stack[stack.length - 1].depth >= row.depth) stack.pop();
      const hidden = stack.some((a) => collapsed.has(a.id));
      if (!hidden) out.push(row);
      if (row.kind === "item") {
        stack.push({ depth: row.depth, id: row.id });
      }
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
  const todayX = (Math.floor(Date.now() / 86400000) - minDay) * DAY_W;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayX - 200);
    }
  }, [todayX]);

  const xToDay = useCallback((px: number) => Math.floor(px / DAY_W) + minDay, [minDay]);

  // Compute bar geometry for a given row (factoring in active resize drag)
  const getBarGeom = useCallback((row: FlatRow & { kind: "item" }, vi: number) => {
    let sd = toDay(row.startDate);
    let ed = toDay(row.endDate);
    if (sd === null && ed === null) return null;

    if (resizeDrag && resizeDrag.vi === vi) {
      const delta = Math.round((resizeDrag.currentX - resizeDrag.anchorX) / DAY_W);
      if (resizeDrag.edge === "left") {
        sd = resizeDrag.origStartDay + delta;
      } else if (resizeDrag.edge === "right") {
        ed = resizeDrag.origEndDay + delta;
      } else {
        sd = resizeDrag.origStartDay + delta;
        ed = resizeDrag.origEndDay + delta;
      }
    }

    const startX = sd !== null ? (sd - minDay) * DAY_W : (ed! - minDay) * DAY_W - 20;
    const endX = ed !== null ? (ed - minDay) * DAY_W : (sd! - minDay) * DAY_W + 20;
    const barW = Math.max(endX - startX, 4);
    const barH = row.level === "Workstream" ? 10 : row.level === "Deliverable" ? 8 : 6;
    const y = 36 + vi * ROW_H + (ROW_H - barH) / 2;
    return { startX, endX, barW, barH, y, sd, ed };
  }, [minDay, resizeDrag]);

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
    if (popover) return;
    const { x, y } = getMousePos(e);
    const rowIdx = Math.floor((y - 36) / ROW_H);
    if (rowIdx < 0 || rowIdx >= visible.length) return;
    const row = visible[rowIdx];

    // Check if clicking on an existing bar's resize handle
    if (row.kind === "item") {
      const geom = getBarGeom(row, rowIdx);
      if (geom) {
        const { startX, endX } = geom;
        if (x >= startX - HANDLE_W && x <= startX + HANDLE_W) {
          e.preventDefault();
          const sd = toDay(row.startDate);
          const ed = toDay(row.endDate);
          if (sd !== null && ed !== null) {
            setResizeDrag({ vi: rowIdx, id: row.id, level: row.level, edge: "left", origStartDay: sd, origEndDay: ed, anchorX: x, currentX: x });
          }
          return;
        }
        if (x >= endX - HANDLE_W && x <= endX + HANDLE_W) {
          e.preventDefault();
          const sd = toDay(row.startDate);
          const ed = toDay(row.endDate);
          if (sd !== null && ed !== null) {
            setResizeDrag({ vi: rowIdx, id: row.id, level: row.level, edge: "right", origStartDay: sd, origEndDay: ed, anchorX: x, currentX: x });
          }
          return;
        }
        if (x > startX + HANDLE_W && x < endX - HANDLE_W) {
          e.preventDefault();
          const sd = toDay(row.startDate);
          const ed = toDay(row.endDate);
          if (sd !== null && ed !== null) {
            setResizeDrag({ vi: rowIdx, id: row.id, level: row.level, edge: "move", origStartDay: sd, origEndDay: ed, anchorX: x, currentX: x });
          }
          return;
        }
      }
    }

    // Drag-to-insert on add rows
    if (row.kind === "add") {
      e.preventDefault();
      setInsertDrag({ vi: rowIdx, level: row.level, parentId: row.parentId, startX: x, currentX: x, active: true });
    }
  }, [visible, popover, getMousePos, getBarGeom]);

  const handleGanttMouseMove = useCallback((e: React.MouseEvent) => {
    const { x, y } = getMousePos(e);

    // Resize drag
    if (resizeDrag) {
      setResizeDrag(prev => prev ? { ...prev, currentX: x } : null);
      return;
    }

    // Insert drag
    if (insertDrag?.active) {
      setInsertDrag(prev => prev ? { ...prev, currentX: x } : null);
      return;
    }

    if (popover) return;

    // Hover detection for bars and add rows
    const rowIdx = Math.floor((y - 36) / ROW_H);
    if (rowIdx >= 0 && rowIdx < visible.length && visible[rowIdx].kind === "add") {
      setHoverVi(rowIdx);
      setHoverX(x);
    } else {
      setHoverVi(null);
    }
  }, [resizeDrag, insertDrag, visible, popover, getMousePos]);

  const handleGanttMouseUp = useCallback(async (e: React.MouseEvent) => {
    // Handle resize end
    if (resizeDrag) {
      const delta = Math.round((resizeDrag.currentX - resizeDrag.anchorX) / DAY_W);
      if (Math.abs(delta) >= 1) {
        let newStart = resizeDrag.origStartDay;
        let newEnd = resizeDrag.origEndDay;
        if (resizeDrag.edge === "left") newStart += delta;
        else if (resizeDrag.edge === "right") newEnd += delta;
        else { newStart += delta; newEnd += delta; }
        if (newStart > newEnd) [newStart, newEnd] = [newEnd, newStart];

        try {
          await updateRoadmapDates({
            id: resizeDrag.id,
            level: resizeDrag.level,
            startDate: dayToIso(newStart),
            endDate: dayToIso(newEnd),
          });
          router.refresh();
        } catch (err) {
          console.error("Failed to update dates:", err);
        }
      }
      setResizeDrag(null);
      return;
    }

    // Handle insert drag end
    if (insertDrag?.active) {
      const { x } = getMousePos(e);
      const x1 = Math.min(insertDrag.startX, x);
      const x2 = Math.max(insertDrag.startX, x);

      if (x2 - x1 < DAY_W * 2) {
        setInsertDrag(null);
        return;
      }

      const sd = xToDay(x1);
      const ed = xToDay(x2);
      setPopover({ vi: insertDrag.vi, level: insertDrag.level, parentId: insertDrag.parentId, startDay: sd, endDay: ed, top: 36 + insertDrag.vi * ROW_H + ROW_H + 4, left: x1 });
      setInsertDrag(null);
      setHoverVi(null);
    }
  }, [resizeDrag, insertDrag, getMousePos, xToDay, router]);

  const handleGanttMouseLeave = useCallback(() => {
    if (!insertDrag?.active && !resizeDrag) setHoverVi(null);
  }, [insertDrag, resizeDrag]);

  if (itemRows.length === 0) return <div className="text-center py-12 text-muted-foreground">No roadmap data.</div>;

  // Ghost bar for insert drag
  const ghostBar = (() => {
    if (insertDrag?.active) {
      const x1 = Math.min(insertDrag.startX, insertDrag.currentX);
      const x2 = Math.max(insertDrag.startX, insertDrag.currentX);
      const y = 36 + insertDrag.vi * ROW_H + (ROW_H - 6) / 2;
      return { x: x1, y, w: x2 - x1, label: `${fmtShort(xToDay(x1))} → ${fmtShort(xToDay(x2))}` };
    }
    if (hoverVi !== null && !popover) {
      const y = 36 + hoverVi * ROW_H + (ROW_H - 6) / 2;
      return { x: hoverX - 30, y, w: 60, label: "Click & drag to add" };
    }
    return null;
  })();

  // Resize label for active resize drag
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
    const barH = row.level === "Workstream" ? 10 : row.level === "Deliverable" ? 8 : 6;
    const y = 36 + resizeDrag.vi * ROW_H + (ROW_H - barH) / 2 - 16;
    const leftX = (sd - minDay) * DAY_W;
    return { x: leftX, y, label: `${fmtShort(sd)} → ${fmtShort(ed)}` };
  })();

  const svgH = 36 + visible.length * ROW_H;

  return (
    <div className="border rounded-lg overflow-hidden bg-card flex" style={{ height: `${Math.min(visible.length * ROW_H + 36, 700)}px` }}>
      {/* Left panel */}
      <div className="shrink-0 overflow-y-auto border-r" style={{ width: LEFT_W }}>
        <div className="sticky top-0 bg-muted/40 border-b text-[11px] text-muted-foreground font-medium px-3 flex items-center" style={{ height: 36 }}>
          Name
        </div>
        {visible.map((row, vi) => {
          if (row.kind === "add") {
            return (
              <div
                key={`add-${row.level}:${row.parentId ?? "root"}`}
                className={`flex items-center border-b transition-colors ${hoverVi === vi || (insertDrag?.vi === vi) || (popover?.vi === vi) ? "bg-blue-50/60" : "hover:bg-accent/20"}`}
                style={{ height: ROW_H, paddingLeft: `${8 + row.depth * 18 + 18}px` }}
              >
                <button
                  onClick={(e) => openAddPopover(row.level, row.parentId, e)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-blue-600 transition-colors"
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  {LEVEL_LABELS[row.level]}
                </button>
              </div>
            );
          }

          const hasKids = row.childCount > 0;
          const isWs = row.level === "Workstream";
          const isEditing = itemPopover?.mode.kind === "edit" && itemPopover.mode.item.id === row.id;
          return (
            <div key={row.id} className={`group/row flex items-center border-b hover:bg-accent/20 ${isWs ? "bg-muted/20" : ""} ${isEditing ? "bg-blue-50/50" : ""}`} style={{ height: ROW_H, paddingLeft: `${8 + row.depth * 18}px` }}>
              {hasKids ? (
                <button onClick={() => toggle(row.id)} className="w-4 h-4 flex items-center justify-center text-[9px] text-muted-foreground hover:text-foreground rounded shrink-0 mr-1">
                  {collapsed.has(row.id) ? "▶" : "▼"}
                </button>
              ) : <span className="w-4 mr-1 shrink-0" />}
              <span className={`truncate text-[12px] flex-1 min-w-0 ${isWs ? "font-semibold" : ""}`} title={row.name}>{row.name}</span>
              <button
                onClick={(e) => openEditPopover(row, e)}
                className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover/row:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-all shrink-0 mr-1"
                title="Edit item"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      {/* Right scrollable Gantt */}
      <div className="flex-1 overflow-auto" ref={scrollRef}>
        <div
          ref={ganttRef}
          style={{ width: totalWidth, minHeight: "100%", cursor: resizeDrag ? (resizeDrag.edge === "move" ? "grabbing" : "col-resize") : undefined }}
          className="relative select-none"
          onMouseDown={handleGanttMouseDown}
          onMouseMove={handleGanttMouseMove}
          onMouseUp={handleGanttMouseUp}
          onMouseLeave={handleGanttMouseLeave}
        >
          {/* Month header */}
          <div className="sticky top-0 bg-muted/40 border-b z-10 flex" style={{ height: 36, width: totalWidth }}>
            {months.map((m, i) => (
              <div key={i} className="absolute text-[10px] text-muted-foreground font-medium border-l border-border/50 pl-1 flex items-center" style={{ left: m.x, height: 36 }}>
                {m.label}
              </div>
            ))}
          </div>

          {/* Grid lines */}
          {months.map((m, i) => (
            <div key={i} className="absolute top-[36px] bottom-0 border-l border-border/20" style={{ left: m.x }} />
          ))}

          {/* Add-row hover/drag stripe backgrounds */}
          {visible.map((row, vi) => {
            if (row.kind !== "add") return null;
            const isActive = hoverVi === vi || insertDrag?.vi === vi || popover?.vi === vi;
            if (!isActive) return null;
            return (
              <div
                key={`stripe-${vi}`}
                className="absolute left-0 right-0 bg-blue-50/40 border-y border-blue-200/40"
                style={{ top: 36 + vi * ROW_H, height: ROW_H, cursor: "crosshair" }}
              />
            );
          })}

          {/* Today line */}
          <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: todayX, width: 2, backgroundColor: "#ef4444" }}>
            <div className="absolute -top-0 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[8px] px-1 rounded-b font-medium" style={{ top: 0 }}>
              Today
            </div>
          </div>

          {/* SVG layer for hierarchy lines + dependency arrows */}
          <svg className="absolute top-0 left-0 pointer-events-none z-[5]" width={totalWidth} height={svgH}>
            <defs>
              <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
              </marker>
            </defs>

            {/* Hierarchy tree lines (parent → child) */}
            {hierarchyEdges.map((edge) => {
              const parentRow = visible[edge.parentVi];
              const childRow = visible[edge.childVi];
              if (parentRow.kind !== "item" || childRow.kind !== "item") return null;

              const pGeom = getBarGeom(parentRow, edge.parentVi);
              const cGeom = getBarGeom(childRow, edge.childVi);

              const parentMidY = 36 + edge.parentVi * ROW_H + ROW_H / 2;
              const childMidY = 36 + edge.childVi * ROW_H + ROW_H / 2;

              let anchorX: number;
              if (pGeom) {
                anchorX = pGeom.startX;
              } else if (cGeom) {
                anchorX = cGeom.startX - 12;
              } else {
                anchorX = 20;
              }

              return (
                <g key={`h-${edge.parentVi}-${edge.childVi}`}>
                  <line x1={anchorX - 4} y1={parentMidY} x2={anchorX - 4} y2={childMidY} stroke="#d1d5db" strokeWidth={1} />
                  <line x1={anchorX - 4} y1={childMidY} x2={anchorX + 6} y2={childMidY} stroke="#d1d5db" strokeWidth={1} />
                </g>
              );
            })}

            {/* Dependency arrows (initiative → initiative) */}
            {(() => {
              const idxMap = new Map<string, number>();
              visible.forEach((r, i) => { if (r.kind === "item") idxMap.set(r.id, i); });

              return dependencies.map((dep) => {
                const fromVi = idxMap.get(dep.dependsOnId);
                const toVi = idxMap.get(dep.initiativeId);
                if (fromVi === undefined || toVi === undefined) return null;
                const fromRow = visible[fromVi];
                const toRow = visible[toVi];
                if (fromRow.kind !== "item" || toRow.kind !== "item") return null;

                const fromGeom = getBarGeom(fromRow, fromVi);
                const toGeom = getBarGeom(toRow, toVi);
                if (!fromGeom || !toGeom) return null;

                const fromEndX = fromGeom.endX;
                const toStartX = toGeom.startX;
                const fromY = 36 + fromVi * ROW_H + ROW_H / 2;
                const toY = 36 + toVi * ROW_H + ROW_H / 2;

                const dx = toStartX - fromEndX;
                if (Math.abs(toY - fromY) < 4) {
                  return <line key={`dep-${dep.dependsOnId}-${dep.initiativeId}`} x1={fromEndX + 2} y1={fromY} x2={toStartX - 2} y2={toY} stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#dep-arrow)" />;
                }
                const cx1 = fromEndX + Math.max(dx * 0.3, 16);
                const cx2 = toStartX - Math.max(dx * 0.3, 16);
                return <path key={`dep-${dep.dependsOnId}-${dep.initiativeId}`} d={`M ${fromEndX + 2} ${fromY} C ${cx1} ${fromY}, ${cx2} ${toY}, ${toStartX - 2} ${toY}`} fill="none" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#dep-arrow)" />;
              });
            })()}
          </svg>

          {/* Bars with resize handles */}
          {visible.map((row, vi) => {
            if (row.kind !== "item") return null;
            const geom = getBarGeom(row, vi);
            if (!geom) return null;

            const { startX, barW, barH, y } = geom;
            const opacity = STATUS_OPACITY[row.status] ?? 0.8;
            const isResizing = resizeDrag?.vi === vi;

            return (
              <div key={row.id} className="absolute group" style={{ left: startX, top: y, width: barW, height: barH }}>
                {/* Bar body */}
                <div
                  className="w-full h-full rounded-sm"
                  style={{ backgroundColor: row.color, opacity: isResizing ? 0.9 : opacity, cursor: "grab" }}
                  title={`${row.name}\n${row.startDate ?? "?"} → ${row.endDate ?? "?"}`}
                />
                {/* Left resize handle */}
                <div
                  className="absolute top-0 h-full opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ left: -HANDLE_W / 2, width: HANDLE_W, cursor: "col-resize" }}
                >
                  <div className="w-[2px] h-full bg-white/80 rounded mx-auto" />
                </div>
                {/* Right resize handle */}
                <div
                  className="absolute top-0 h-full opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ right: -HANDLE_W / 2, width: HANDLE_W, cursor: "col-resize" }}
                >
                  <div className="w-[2px] h-full bg-white/80 rounded mx-auto" />
                </div>
              </div>
            );
          })}

          {/* Resize drag date label */}
          {resizeLabel && (
            <div className="absolute pointer-events-none z-30 text-[9px] font-medium text-blue-700 bg-white/90 border border-blue-300 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap" style={{ left: resizeLabel.x, top: resizeLabel.y }}>
              {resizeLabel.label}
            </div>
          )}

          {/* Ghost / drag preview bar for new items */}
          {ghostBar && (
            <div className="absolute pointer-events-none z-30" style={{ left: ghostBar.x, top: ghostBar.y, width: Math.max(ghostBar.w, 4), height: 6 }}>
              <div className="w-full h-full rounded-sm bg-blue-400/50 border border-blue-400 border-dashed" />
              <div className="absolute -top-4 left-0 text-[9px] text-blue-600 font-medium whitespace-nowrap bg-white/80 px-1 rounded">
                {ghostBar.label}
              </div>
            </div>
          )}

          {/* Popover form after drag-to-insert */}
          {popover && (
            <DragInsertPopover
              level={popover.level}
              parentId={popover.parentId}
              startDay={popover.startDay}
              endDay={popover.endDay}
              top={popover.top}
              left={popover.left}
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          )}
        </div>
      </div>

      {/* Item popover (add or edit — portal-style, fixed position) */}
      {itemPopover && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={handleItemPopoverCancel} />
          <ItemPopover
            mode={itemPopover.mode}
            anchorRect={itemPopover.anchorRect}
            onSaved={handleItemPopoverSaved}
            onCancel={handleItemPopoverCancel}
          />
        </>
      )}
    </div>
  );
}

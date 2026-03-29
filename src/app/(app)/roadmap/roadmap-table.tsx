"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addRoadmapItem } from "@/lib/actions/add-roadmap-item";
import { updateRoadmapItem } from "@/lib/actions/update-roadmap-dates";

// ─── Types ───────────────────────────────────────────

interface PersonRef { id: string; name: string; initials: string | null }

interface SubTaskRow {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  points: number; completionPercent: number;
  assignee: PersonRef | null;
}

interface InitiativeRow {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  ownerInitials: string | null; totalPoints: number;
  subTasks: SubTaskRow[];
}

interface DeliverableRow {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  points: number; initiatives: InitiativeRow[];
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
}

interface AddButtonRow {
  kind: "add";
  level: Level;
  parentId: string | null;
  depth: number;
}

type DisplayRow = (FlatRow & { kind: "item" }) | AddButtonRow;

// ─── Styles ──────────────────────────────────────────

const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  "Not started": { dot: "#d1d5db", text: "#6b7280" },
  NOT_STARTED:   { dot: "#d1d5db", text: "#6b7280" },
  "In progress": { dot: "#3b82f6", text: "#1d4ed8" },
  IN_PROGRESS:   { dot: "#3b82f6", text: "#1d4ed8" },
  BLOCKED:       { dot: "#ef4444", text: "#dc2626" },
  Done:          { dot: "#22c55e", text: "#15803d" },
  DONE:          { dot: "#22c55e", text: "#15803d" },
};
const DEF_ST = { dot: "#d1d5db", text: "#6b7280" };

const LEVEL_STYLE: Record<Level, { bg: string; text: string }> = {
  Workstream:  { bg: "#e8e5e3", text: "#6b6560" },
  Deliverable: { bg: "#fadec9", text: "#9a5b35" },
  Feature:     { bg: "#d3e5ef", text: "#2e6b8a" },
  Task:        { bg: "#dbeddb", text: "#2b6e2b" },
};

function statusLabel(s: string): string {
  return ({ NOT_STARTED: "Not started", IN_PROGRESS: "In progress", BLOCKED: "Blocked", DONE: "Done" } as Record<string, string>)[s] ?? s;
}

function fmtDate(d: string | null): string {
  if (!d) return "";
  const p = new Date(d);
  return isNaN(p.getTime()) ? "" : p.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtRange(s: string | null, e: string | null): string {
  const a = fmtDate(s), b = fmtDate(e);
  if (a && b) return `${a} → ${b}`;
  return a || b || "";
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "DONE", label: "Done" },
];

const LEVEL_LABELS: Record<Level, string> = {
  Workstream: "Workstream",
  Deliverable: "Deliverable",
  Feature: "Feature",
  Task: "Task",
};

// ─── Flatten with Add-buttons ────────────────────────

function buildDisplayRows(workstreams: WorkstreamRow[]): DisplayRow[] {
  const rows: DisplayRow[] = [];

  for (const ws of workstreams) {
    rows.push({ kind: "item", id: ws.id, name: ws.name, level: "Workstream", status: ws.status, startDate: ws.startDate, endDate: ws.endDate, assign: null, depth: 0, childCount: ws.deliverables.length + ws.initiatives.length });

    for (const del of ws.deliverables) {
      rows.push({ kind: "item", id: del.id, name: del.name, level: "Deliverable", status: del.status, startDate: del.startDate, endDate: del.endDate, assign: null, depth: 1, childCount: del.initiatives.length });

      for (const init of del.initiatives) {
        addInit(rows, init, 2);
      }
      rows.push({ kind: "add", level: "Feature", parentId: del.id, depth: 2 });
    }

    for (const init of ws.initiatives) {
      addInit(rows, init, 1);
    }

    rows.push({ kind: "add", level: "Deliverable", parentId: ws.id, depth: 1 });
  }

  rows.push({ kind: "add", level: "Workstream", parentId: null, depth: 0 });

  return rows;
}

function addInit(rows: DisplayRow[], init: InitiativeRow, depth: number) {
  rows.push({ kind: "item", id: init.id, name: init.name, level: "Feature", status: init.status, startDate: init.startDate, endDate: init.endDate, assign: init.ownerInitials, depth, childCount: init.subTasks.length });
  for (const sub of init.subTasks) {
    rows.push({ kind: "item", id: sub.id, name: sub.name, level: "Task", status: sub.status, startDate: sub.startDate, endDate: sub.endDate, assign: sub.assignee?.name ?? null, depth: depth + 1, childCount: 0 });
  }
  rows.push({ kind: "add", level: "Task", parentId: init.id, depth: depth + 1 });
}

// ─── Unified Item Form Card (add + edit) ─────────────

interface PersonOption { id: string; name: string }

const FORM_STATUS_OPTS = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "DONE", label: "Done" },
];

const RISK_LEVELS: { value: string; label: string }[] = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Med" },
  { value: "High", label: "High" },
  { value: "Very High", label: "V.High" },
];

function formCalcPoints(days: number, risk: string): number {
  if (!days || days <= 0) return 0;
  switch (risk) {
    case "Very High": return Math.ceil(days + 4);
    case "High":      return Math.ceil(days + 3);
    case "Medium":    return Math.ceil(days + 2);
    case "Low":       return Math.ceil(days < 1 ? days * 2 : days + 1);
    default:          return Math.ceil(days);
  }
}

function toFormStatus(s: string): string {
  return ({ "Not started": "NOT_STARTED", "In progress": "IN_PROGRESS", Blocked: "BLOCKED", Done: "DONE" } as Record<string, string>)[s] ?? s;
}

function toIsoDate(d: string | null): string {
  if (!d) return "";
  const p = new Date(d);
  return isNaN(p.getTime()) ? "" : p.toISOString().slice(0, 10);
}

type FormMode = { kind: "add"; level: Level; parentId: string | null; depth: number; people: PersonOption[] }
             | { kind: "edit"; row: FlatRow };

function ItemFormCard({ mode, onSaved, onCancel }: { mode: FormMode; onSaved: () => void; onCancel: () => void }) {
  const isEdit = mode.kind === "edit";
  const level = isEdit ? mode.row.level : mode.level;
  const depth = isEdit ? mode.row.depth : mode.depth;
  const people = isEdit ? [] : mode.people;

  const [name, setName] = useState(isEdit ? mode.row.name : "");
  const [status, setStatus] = useState(isEdit ? toFormStatus(mode.row.status) : "NOT_STARTED");
  const [startDate, setStartDate] = useState(isEdit ? toIsoDate(mode.row.startDate) : "");
  const [endDate, setEndDate] = useState(isEdit ? toIsoDate(mode.row.endDate) : "");
  const [estimatedDays, setEstimatedDays] = useState("");
  const [riskLevel, setRiskLevel] = useState("Medium");
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEdit) nameRef.current?.select();
    else nameRef.current?.focus();
  }, [isEdit]);

  const parsedDays = estimatedDays ? parseFloat(estimatedDays) : 0;
  const computedPoints = formCalcPoints(parsedDays, riskLevel);

  const handleSave = useCallback(async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      if (isEdit) {
        await updateRoadmapItem({
          id: mode.row.id,
          level: mode.row.level,
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
          estimatedDays: days,
          riskLevel: mode.level === "Task" ? riskLevel : undefined,
          startDate: startDate || null,
          endDate: endDate || null,
          assigneeId: assigneeId || null,
        });
      }
      onSaved();
    } catch (err) {
      console.error("Failed to save:", err);
      setSaving(false);
    }
  }, [isEdit, mode, name, status, startDate, endDate, estimatedDays, riskLevel, assigneeId, saving, onSaved]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") onCancel();
  }, [handleSave, onCancel]);

  const lv = LEVEL_STYLE[level];
  const accentColor = isEdit ? "border-l-amber-400" : "border-l-blue-400";
  const bgColor = isEdit ? "bg-amber-50/50" : "bg-blue-50/50";
  const labelCls = "block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5";
  const fieldCls = "w-full h-7 text-[11px] bg-white border border-border rounded px-2 focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <tr className="border-b">
      <td colSpan={5} className="p-0">
        <div className={`${bgColor} border-l-4 ${accentColor} px-4 py-3`} style={{ marginLeft: `${depth * 20}px` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: lv.bg, color: lv.text }}>
              {isEdit ? "Edit" : "New"} {LEVEL_LABELS[level]}
            </span>
            <button onClick={onCancel} disabled={saving} className="text-xs text-muted-foreground hover:text-foreground transition-colors">✕</button>
          </div>

          <div className="mb-3">
            <label className={labelCls}>Name *</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`${LEVEL_LABELS[level]} name…`}
              className={fieldCls}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 mb-3">
            <div>
              <label className={labelCls}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} onKeyDown={handleKeyDown} className={fieldCls} disabled={saving}>
                {FORM_STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} onKeyDown={handleKeyDown} className={fieldCls} disabled={saving} />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} onKeyDown={handleKeyDown} className={fieldCls} disabled={saving} />
            </div>
            {!isEdit && level === "Task" && people.length > 0 && (
              <div>
                <label className={labelCls}>Assignee</label>
                <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={fieldCls} disabled={saving}>
                  <option value="">Unassigned</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {!isEdit && level === "Task" && (
            <div className="grid grid-cols-3 gap-x-3 gap-y-2 mb-3">
              <div>
                <label className={labelCls}>Estimated Days</label>
                <input type="number" min={0} step="0.5" value={estimatedDays} onChange={e => setEstimatedDays(e.target.value)} onKeyDown={handleKeyDown} placeholder="e.g. 2.5" className={fieldCls} disabled={saving} />
              </div>
              <div>
                <label className={labelCls}>Risk Level</label>
                <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} className={fieldCls} disabled={saving}>
                  {RISK_LEVELS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Points</label>
                <div className="h-7 flex items-center text-xs font-semibold text-blue-600 px-2 bg-blue-100/60 border border-blue-200 rounded">
                  {computedPoints || "—"}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="text-[11px] font-medium px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save Changes" : `Create ${LEVEL_LABELS[level]}`)}
            </button>
            <button onClick={onCancel} disabled={saving} className="text-[11px] font-medium px-3 py-1.5 rounded text-muted-foreground hover:bg-accent transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Component ───────────────────────────────────────

export function RoadmapTable({ workstreams, people = [], collapseSignal = 0 }: { workstreams: WorkstreamRow[]; people?: { id: string; name: string }[]; collapseSignal?: number }) {
  const allRows = useMemo(() => buildDisplayRows(workstreams), [workstreams]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingAt, setAddingAt] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const router = useRouter();

  const collapsibleIds = useMemo(() => allRows.filter(r => r.kind === "item" && r.childCount > 0).map(r => (r as FlatRow & { kind: "item" }).id), [allRows]);

  useEffect(() => {
    if (collapseSignal === 0) return;
    if (collapseSignal > 0) setCollapsed(new Set(collapsibleIds));
    else setCollapsed(new Set());
  }, [collapseSignal, collapsibleIds]);

  const toggle = (id: string) => {
    setCollapsed((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

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

  const addKey = useCallback((level: Level, parentId: string | null) => `${level}:${parentId ?? "root"}`, []);

  const handleSaved = useCallback(() => {
    setAddingAt(null);
    router.refresh();
  }, [router]);

  const handleCancel = useCallback(() => {
    setAddingAt(null);
  }, []);

  const handleEditSaved = useCallback(() => {
    setEditingId(null);
    router.refresh();
  }, [router]);

  const handleEditCancel = useCallback(() => {
    setEditingId(null);
  }, []);

  if (allRows.length <= 1) return <div className="text-center py-12 text-muted-foreground">No roadmap data.</div>;

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b bg-muted/40 text-[11px] text-muted-foreground">
              <th className="text-left font-medium px-3 py-2 min-w-[320px]">Name</th>
              <th className="text-left font-medium px-2 py-2 w-[90px]">Level</th>
              <th className="text-left font-medium px-2 py-2 w-[100px]">Status</th>
              <th className="text-left font-medium px-2 py-2 w-[150px]">Date</th>
              <th className="text-left font-medium px-2 py-2 w-[120px]">Assign</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              if (row.kind === "add") {
                const key = addKey(row.level, row.parentId);
                if (addingAt === key) {
                  return (
                    <ItemFormCard
                      key={`form-${key}`}
                      mode={{ kind: "add", level: row.level, parentId: row.parentId, depth: row.depth, people }}
                      onSaved={handleSaved}
                      onCancel={handleCancel}
                    />
                  );
                }
                return (
                  <tr key={`add-${key}`} className="border-b hover:bg-accent/20 transition-colors">
                    <td colSpan={5} className="px-3 py-1">
                      <button
                        onClick={() => setAddingAt(key)}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-blue-600 transition-colors"
                        style={{ paddingLeft: `${row.depth * 20 + 20}px` }}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        Add {LEVEL_LABELS[row.level]}
                      </button>
                    </td>
                  </tr>
                );
              }

              if (editingId === row.id) {
                return (
                  <ItemFormCard key={`edit-${row.id}`} mode={{ kind: "edit", row }} onSaved={handleEditSaved} onCancel={handleEditCancel} />
                );
              }

              const isWs = row.level === "Workstream";
              const hasKids = row.childCount > 0;
              const st = STATUS_STYLES[row.status] ?? DEF_ST;
              const lv = LEVEL_STYLE[row.level];
              return (
                <tr key={row.id} className={`group/row border-b hover:bg-accent/30 transition-colors ${isWs ? "bg-muted/20 font-medium" : ""}`}>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${row.depth * 20}px` }}>
                      {hasKids ? (
                        <button onClick={() => toggle(row.id)} className="w-5 h-5 flex items-center justify-center text-[10px] text-muted-foreground hover:text-foreground rounded hover:bg-accent shrink-0">
                          {collapsed.has(row.id) ? "▶" : "▼"}
                        </button>
                      ) : <span className="w-5 shrink-0" />}
                      <span className="truncate text-[13px] flex-1 min-w-0" title={row.name}>{row.name}</span>
                      <button
                        onClick={() => setEditingId(row.id)}
                        className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover/row:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-all shrink-0"
                        title="Edit item"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: lv.bg, color: lv.text }}>{row.level}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: st.dot }} />
                      <span className="text-[11px]" style={{ color: st.text }}>{statusLabel(row.status)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">{fmtRange(row.startDate, row.endDate)}</td>
                  <td className="px-2 py-1.5 text-[11px] text-muted-foreground truncate max-w-[120px]">{row.assign ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

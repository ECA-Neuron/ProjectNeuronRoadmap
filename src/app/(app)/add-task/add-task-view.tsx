"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { addRoadmapItem } from "@/lib/actions/add-roadmap-item";

interface SubTask { id: string; name: string; points: number; completionPercent: number; status: string }
interface Initiative { id: string; name: string; status: string; subTasks: SubTask[] }
interface Deliverable { id: string; name: string; initiatives: Initiative[] }
interface Workstream { id: string; name: string; deliverables?: Deliverable[]; initiatives: Initiative[] }
interface PersonOption { id: string; name: string }

const STATUS_OPTS = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "DONE", label: "Done" },
];

const RISK_LEVELS = [
  { value: "Low", label: "Low (+1 or ×2 if <1d)" },
  { value: "Medium", label: "Medium (+2)" },
  { value: "High", label: "High (+3)" },
  { value: "Very High", label: "Very High (+4)" },
];

function calcPoints(days: number, risk: string): number {
  if (!days || days <= 0) return 0;
  switch (risk) {
    case "Very High": return Math.ceil(days + 4);
    case "High":      return Math.ceil(days + 3);
    case "Medium":    return Math.ceil(days + 2);
    case "Low":       return Math.ceil(days < 1 ? days * 2 : days + 1);
    default:          return Math.ceil(days);
  }
}

export function AddTaskView({ workstreams, people }: { workstreams: Workstream[]; people: PersonOption[] }) {
  const router = useRouter();
  const [wsId, setWsId] = useState("");
  const [delId, setDelId] = useState("");
  const [initId, setInitId] = useState("");
  const [taskName, setTaskName] = useState("");
  const [estimatedDays, setEstimatedDays] = useState("");
  const [riskLevel, setRiskLevel] = useState("Medium");
  const [status, setStatus] = useState("NOT_STARTED");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<{ name: string; id: string }[]>([]);

  const activeWs = workstreams.find(w => w.id === wsId);
  const deliverables = activeWs?.deliverables ?? [];
  const activeDel = deliverables.find(d => d.id === delId);
  const features = activeDel ? activeDel.initiatives : (activeWs?.initiatives ?? []);

  const handleWs = (v: string) => { setWsId(v); setDelId(""); setInitId(""); };
  const handleDel = (v: string) => { setDelId(v); setInitId(""); };

  const parsedDays = estimatedDays ? parseFloat(estimatedDays) : 0;
  const computedPoints = calcPoints(parsedDays, riskLevel);

  const handleSave = useCallback(async () => {
    if (!initId || !taskName.trim() || saving) return;
    setSaving(true);
    setFlash(null);
    try {
      const days = estimatedDays ? parseFloat(estimatedDays) : null;
      const result = await addRoadmapItem({
        level: "Task",
        name: taskName.trim(),
        parentId: initId,
        status,
        estimatedDays: days,
        riskLevel,
        startDate: startDate || null,
        endDate: endDate || null,
        assigneeId: assigneeId || null,
      });
      setRecentlyAdded(prev => [{ name: taskName.trim(), id: result.id }, ...prev].slice(0, 10));
      setFlash({ text: `"${taskName.trim()}" created and pushed to Notion`, ok: true });
      setTaskName("");
      setEstimatedDays("");
      setRiskLevel("Medium");
      setStartDate("");
      setEndDate("");
      setAssigneeId("");
      setStatus("NOT_STARTED");
      router.refresh();
    } catch (err) {
      setFlash({ text: `Error: ${err instanceof Error ? err.message : String(err)}`, ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setFlash(null), 6000);
    }
  }, [initId, taskName, estimatedDays, riskLevel, status, startDate, endDate, assigneeId, saving, router]);

  const labelCls = "block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1";
  const inputCls = "w-full h-8 text-xs border rounded px-2 bg-background focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add Task</h1>
        <p className="text-muted-foreground mt-1">
          Create a new task under any feature. It will be saved to the database and pushed to Notion automatically.
        </p>
      </div>

      {flash && (
        <div className={`text-xs px-3 py-2 rounded ${flash.ok ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {flash.text}
        </div>
      )}

      <div className="rounded-lg border border-border p-6 space-y-5">
        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Hierarchy</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Workstream *</label>
            <select value={wsId} onChange={e => handleWs(e.target.value)} className={inputCls}>
              <option value="">Select workstream…</option>
              {workstreams.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Deliverable</label>
            <select value={delId} onChange={e => handleDel(e.target.value)} disabled={!wsId} className={`${inputCls} disabled:opacity-50`}>
              <option value="">All / None</option>
              {deliverables.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Feature *</label>
            <select value={initId} onChange={e => setInitId(e.target.value)} disabled={!wsId} className={`${inputCls} disabled:opacity-50`}>
              <option value="">Select feature…</option>
              {features.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>

        <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wider pt-2">Task Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Task Name *</label>
            <input
              type="text"
              value={taskName}
              onChange={e => setTaskName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
              placeholder="e.g. Build login page"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Estimated Days *</label>
            <input type="number" min={0} step="0.5" value={estimatedDays} onChange={e => setEstimatedDays(e.target.value)} placeholder="e.g. 2.5" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Risk Level</label>
            <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} className={inputCls}>
              {RISK_LEVELS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Calculated Points</label>
            <div className="h-8 flex items-center text-sm font-semibold text-blue-600 px-2 bg-blue-50 border border-blue-200 rounded">
              {computedPoints || "—"}
            </div>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
              {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
          </div>
          {people.length > 0 && (
            <div>
              <label className={labelCls}>Assignee</label>
              <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={inputCls}>
                <option value="">Unassigned</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={!initId || !taskName.trim() || saving}
            className="px-5 py-2.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Creating…" : "Create Task"}
          </button>
        </div>
      </div>

      {recentlyAdded.length > 0 && (
        <div className="rounded-lg border border-border p-5">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Recently Added</h3>
          <div className="space-y-1.5">
            {recentlyAdded.map((item, i) => (
              <div key={`${item.id}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                {item.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRoadmapItem } from "@/lib/actions/update-roadmap-dates";

interface PersonRef { id: string; name: string; initials: string | null }

interface SubTaskRow {
  id: string; name: string; status: string;
  startDate: string | null; endDate: string | null;
  points?: number; completionPercent?: number;
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
  deliverables: DeliverableRow[];
  initiatives: InitiativeRow[];
}

type KanbanColumn = "NOT_STARTED" | "IN_PROGRESS" | "DONE";

interface KanbanCard {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  assignee: PersonRef | null;
  points: number;
  completionPercent: number;
  featureName: string | null;
  deliverableName: string | null;
  workstreamName: string;
  workstreamColor: string;
}

const COLUMN_CONFIG: { key: KanbanColumn; label: string; dotColor: string; bgAccent: string }[] = [
  { key: "NOT_STARTED", label: "Not Started", dotColor: "bg-gray-400", bgAccent: "bg-gray-500/5 dark:bg-gray-500/5" },
  { key: "IN_PROGRESS", label: "In Progress", dotColor: "bg-blue-500", bgAccent: "bg-blue-500/5 dark:bg-blue-500/5" },
  { key: "DONE", label: "Finished", dotColor: "bg-emerald-500", bgAccent: "bg-emerald-500/5 dark:bg-emerald-500/5" },
];

function normalizeStatus(s: string): KanbanColumn {
  const upper = s.toUpperCase().replace(/\s+/g, "_");
  if (upper === "DONE" || upper === "COMPLETE" || upper === "COMPLETED") return "DONE";
  if (upper === "IN_PROGRESS" || upper === "IN PROGRESS") return "IN_PROGRESS";
  if (upper === "BLOCKED") return "IN_PROGRESS";
  return "NOT_STARTED";
}

function flattenTasks(workstreams: WorkstreamRow[]): KanbanCard[] {
  const cards: KanbanCard[] = [];
  for (const ws of workstreams) {
    const addInit = (init: InitiativeRow, delName: string | null) => {
      for (const sub of init.subTasks) {
        cards.push({
          id: sub.id,
          name: sub.name,
          status: sub.status,
          startDate: sub.startDate,
          endDate: sub.endDate,
          assignee: sub.assignee,
          points: (sub as any).points ?? 0,
          completionPercent: (sub as any).completionPercent ?? 0,
          featureName: init.name,
          deliverableName: delName,
          workstreamName: ws.name,
          workstreamColor: ws.color || "#6b7280",
        });
      }
    };
    for (const del of ws.deliverables) {
      for (const init of del.initiatives) addInit(init, del.name);
    }
    for (const init of ws.initiatives) addInit(init, null);
  }
  return cards;
}

function fmtDate(d: string | null): string {
  if (!d) return "";
  const dt = d.includes("T") ? new Date(d) : new Date(d + "T12:00:00Z");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function RoadmapKanban({ workstreams }: { workstreams: WorkstreamRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<KanbanColumn | null>(null);
  const [search, setSearch] = useState("");
  const [wsFilter, setWsFilter] = useState<string>("ALL");

  const allCards = useMemo(() => flattenTasks(workstreams), [workstreams]);

  const filtered = useMemo(() => {
    let cards = allCards;
    if (wsFilter !== "ALL") cards = cards.filter(c => c.workstreamName === wsFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      cards = cards.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.featureName?.toLowerCase().includes(q) ||
        c.assignee?.name.toLowerCase().includes(q)
      );
    }
    return cards;
  }, [allCards, wsFilter, search]);

  const columns = useMemo(() => {
    const groups: Record<KanbanColumn, KanbanCard[]> = { NOT_STARTED: [], IN_PROGRESS: [], DONE: [] };
    for (const card of filtered) {
      const col = normalizeStatus(card.status);
      groups[col].push(card);
    }
    return groups;
  }, [filtered]);

  const wsNames = useMemo(() => [...new Set(allCards.map(c => c.workstreamName))].sort(), [allCards]);

  const handleDragStart = useCallback((e: React.DragEvent, cardId: string) => {
    setDragId(cardId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cardId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, col: KanbanColumn) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(col);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetCol: KanbanColumn) => {
    e.preventDefault();
    setDropTarget(null);
    const cardId = e.dataTransfer.getData("text/plain");
    if (!cardId) return;

    const card = allCards.find(c => c.id === cardId);
    if (!card) return;

    const currentCol = normalizeStatus(card.status);
    if (currentCol === targetCol) { setDragId(null); return; }

    const newStatus = targetCol;
    startTransition(async () => {
      try {
        await updateRoadmapItem({ id: cardId, level: "Task", status: newStatus });
        router.refresh();
      } catch (err) {
        console.error("Failed to update status:", err);
      }
    });
    setDragId(null);
  }, [allCards, router]);

  const handleQuickStatus = useCallback(async (cardId: string, newStatus: string) => {
    startTransition(async () => {
      try {
        await updateRoadmapItem({ id: cardId, level: "Task", status: newStatus });
        router.refresh();
      } catch (err) {
        console.error("Failed to update status:", err);
      }
    });
  }, [router]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-[12px] bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500/40 placeholder:text-muted-foreground/50"
          />
        </div>
        <select
          value={wsFilter}
          onChange={e => setWsFilter(e.target.value)}
          className="h-8 text-[12px] bg-background border border-border/60 rounded-lg px-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
        >
          <option value="ALL">All Workstreams</option>
          {wsNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="text-[11px] text-muted-foreground tabular-nums">{filtered.length} tasks</div>
      </div>

      {/* Board */}
      <div className="grid grid-cols-3 gap-4" style={{ minHeight: 400 }}>
        {COLUMN_CONFIG.map(col => {
          const cards = columns[col.key];
          const isDropping = dropTarget === col.key;
          return (
            <div
              key={col.key}
              className={`rounded-xl border transition-all duration-200 ${
                isDropping
                  ? "border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 shadow-md"
                  : "border-border/60 bg-card"
              }`}
              onDragOver={e => handleDragOver(e, col.key)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, col.key)}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
                <span className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                <span className="text-[13px] font-semibold">{col.label}</span>
                <span className="ml-auto text-[11px] text-muted-foreground tabular-nums bg-muted/50 px-1.5 py-0.5 rounded-md">{cards.length}</span>
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2 max-h-[560px] overflow-y-auto">
                {cards.length === 0 && (
                  <div className={`flex items-center justify-center py-8 rounded-lg ${col.bgAccent}`}>
                    <p className="text-[11px] text-muted-foreground/60">No tasks</p>
                  </div>
                )}
                {cards.map(card => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={e => handleDragStart(e, card.id)}
                    onDragEnd={() => setDragId(null)}
                    className={`group rounded-lg border border-border/40 bg-background p-3 cursor-grab active:cursor-grabbing transition-all duration-150 hover:shadow-md hover:border-border/80 ${
                      dragId === card.id ? "opacity-40 scale-95" : ""
                    }`}
                  >
                    {/* Workstream indicator */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: card.workstreamColor }} />
                      <span className="text-[9px] text-muted-foreground/70 font-medium truncate">{card.workstreamName}</span>
                    </div>

                    {/* Title */}
                    <p className="text-[12px] font-medium leading-snug mb-2 line-clamp-2">{card.name}</p>

                    {/* Feature/deliverable */}
                    {card.featureName && (
                      <p className="text-[10px] text-muted-foreground truncate mb-2">
                        {card.deliverableName ? `${card.deliverableName} → ` : ""}{card.featureName}
                      </p>
                    )}

                    {/* Meta row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {card.endDate && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">{fmtDate(card.endDate)}</span>
                      )}
                      {card.points > 0 && (
                        <span className="text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{card.points} pts</span>
                      )}
                      {card.assignee && (
                        <span className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-[8px] font-bold text-white shrink-0" title={card.assignee.name}>
                          {card.assignee.initials || card.assignee.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Quick status dropdown (visible on hover) */}
                    <div className="mt-2 pt-2 border-t border-border/30 opacity-0 group-hover:opacity-100 transition-opacity">
                      <select
                        value={normalizeStatus(card.status)}
                        onChange={e => handleQuickStatus(card.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full h-6 text-[10px] bg-muted/50 border-0 rounded px-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500/40 cursor-pointer"
                      >
                        <option value="NOT_STARTED">Not Started</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="DONE">Finished</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {isPending && (
        <div className="fixed bottom-4 right-4 bg-card border border-border/60 rounded-lg px-3 py-2 shadow-elevated text-[11px] text-muted-foreground flex items-center gap-2 z-50 animate-fade-in">
          <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
          Updating...
        </div>
      )}
    </div>
  );
}

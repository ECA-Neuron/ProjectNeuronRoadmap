"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RoadmapTable } from "./roadmap-table";
import { RoadmapTimeline } from "./roadmap-timeline";
import { RoadmapKanban } from "./roadmap-kanban";

interface DepEdge { initiativeId: string; dependsOnId: string }

interface RoadmapTabsProps {
  workstreams: any[];
  people: any[];
  progressLogs: any[];
  dependencies: DepEdge[];
  currentUserName?: string;
}

type ViewMode = "table" | "timeline" | "kanban";

const VIEW_TABS: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
  {
    key: "table",
    label: "Table",
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0 1 12 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M12 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M21.375 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125M12 17.25v-5.25" /></svg>,
  },
  {
    key: "timeline",
    label: "Timeline",
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" /></svg>,
  },
  {
    key: "kanban",
    label: "Board",
    icon: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125Z" /></svg>,
  },
];

export function RoadmapTabs({ workstreams, people, progressLogs, dependencies, currentUserName }: RoadmapTabsProps) {
  const [view, setView] = useState<ViewMode>("table");
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const [collapseSignal, setCollapseSignal] = useState(0);
  const router = useRouter();

  const doSync = useCallback(async (direction: "pull" | "push") => {
    const setLoading = direction === "pull" ? setPulling : setPushing;
    setLoading(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const data = await res.json();
      if (!res.ok) { setSyncMsg({ text: data.error ?? `Sync failed (${res.status})`, type: "err" }); return; }
      const label = direction === "pull" ? "Pulled" : "Pushed";
      const errCount = data.errors?.length ?? 0;
      setSyncMsg({ text: `${label} ${data.synced} items${errCount > 0 ? ` (${errCount} errors)` : ""}`, type: errCount > 0 ? "err" : "ok" });
      router.refresh();
    } catch {
      setSyncMsg({ text: "Network error", type: "err" });
    } finally {
      setLoading(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  }, [router]);

  const showTreeControls = view === "table" || view === "timeline";

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border/60 mb-5 pb-3">
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex bg-muted/40 rounded-lg p-0.5 gap-0.5">
            {VIEW_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-all duration-150 ${
                  view === tab.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Collapse/expand only for tree views */}
          {showTreeControls && (
            <div className="flex items-center gap-1 ml-1">
              <button
                onClick={() => setCollapseSignal(prev => Math.abs(prev) + 1)}
                className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
                title="Collapse All"
              >
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" /></svg>
                  Collapse
                </span>
              </button>
              <button
                onClick={() => setCollapseSignal(prev => -(Math.abs(prev) + 1))}
                className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
                title="Expand All"
              >
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
                  Expand
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {syncMsg && (
            <span className={`text-[10px] px-2.5 py-1 rounded-md font-medium ${
              syncMsg.type === "ok"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}>{syncMsg.text}</span>
          )}
          <button
            onClick={() => doSync("pull")}
            disabled={pulling || pushing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg border border-border/60 bg-card hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pulling ? <Spinner /> : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            )}
            Pull
          </button>
          <button
            onClick={() => doSync("push")}
            disabled={pulling || pushing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pushing ? <Spinner /> : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
            )}
            Push
          </button>
        </div>
      </div>

      {/* Content */}
      {view === "table" && (
        <RoadmapTable workstreams={workstreams} people={people} collapseSignal={collapseSignal} />
      )}
      {view === "timeline" && (
        <RoadmapTimeline workstreams={workstreams} dependencies={dependencies} people={people} collapseSignal={collapseSignal} currentUserName={currentUserName} />
      )}
      {view === "kanban" && (
        <RoadmapKanban workstreams={workstreams} />
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

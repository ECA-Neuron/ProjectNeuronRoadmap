"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RoadmapTable } from "./roadmap-table";
import { RoadmapTimeline } from "./roadmap-timeline";

interface DepEdge { initiativeId: string; dependsOnId: string }

interface RoadmapTabsProps {
  workstreams: any[];
  people: any[];
  progressLogs: any[];
  dependencies: DepEdge[];
}

export function RoadmapTabs({ workstreams, people, progressLogs, dependencies }: RoadmapTabsProps) {
  const [view, setView] = useState<"table" | "timeline">("table");
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

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border mb-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setView("table")}
              className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
                view === "table" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M3 6h18M3 18h18" />
                </svg>
                Table
              </span>
            </button>
            <button
              onClick={() => setView("timeline")}
              className={`px-3 py-1.5 text-[11px] font-medium transition-colors border-l border-border ${
                view === "timeline" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M9 4v16m-6 0h18" />
                </svg>
                Timeline
              </span>
            </button>
          </div>
          <button
            onClick={() => setCollapseSignal(prev => Math.abs(prev) + 1)}
            className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
            title="Collapse All"
          >
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8h16M4 16h16" />
              </svg>
              Collapse
            </span>
          </button>
          <button
            onClick={() => setCollapseSignal(prev => -(Math.abs(prev) + 1))}
            className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
            title="Expand All"
          >
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              Expand
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {syncMsg && (
            <span className={`text-[10px] px-2 py-0.5 rounded ${
              syncMsg.type === "ok" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}>{syncMsg.text}</span>
          )}
          <button
            onClick={() => doSync("pull")}
            disabled={pulling || pushing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pulling ? <Spinner /> : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
              </svg>
            )}
            Pull from Notion
          </button>
          <button
            onClick={() => doSync("push")}
            disabled={pulling || pushing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pushing ? <Spinner /> : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20V8m0 0l4 4m-4-4l-4 4M4 4h16" />
              </svg>
            )}
            Push to Notion
          </button>
        </div>
      </div>

      {/* Content */}
      {view === "table" ? (
        <RoadmapTable workstreams={workstreams} people={people} collapseSignal={collapseSignal} />
      ) : (
        <RoadmapTimeline workstreams={workstreams} dependencies={dependencies} people={people} collapseSignal={collapseSignal} />
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

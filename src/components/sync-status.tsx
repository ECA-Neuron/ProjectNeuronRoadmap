"use client";

import { useLiveSync } from "@/hooks/use-live-sync";

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function SyncStatus() {
  const { syncing, lastPulledAt, error, triggerSync } = useLiveSync();

  return (
    <button
      type="button"
      onClick={triggerSync}
      disabled={syncing}
      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
      title={
        error
          ? `Sync error: ${error}`
          : syncing
            ? "Syncing with Notion..."
            : lastPulledAt
              ? `Last synced ${timeAgo(lastPulledAt)}. Click to sync now.`
              : "Click to sync with Notion"
      }
    >
      {/* Notion-style sync icon */}
      <svg
        className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M2 8a6 6 0 0 1 10.24-4.24" />
        <path d="M14 8a6 6 0 0 1-10.24 4.24" />
        <polyline points="2 4 2 8 6 8" />
        <polyline points="14 12 14 8 10 8" />
      </svg>

      {error ? (
        <span className="text-red-500">Sync error</span>
      ) : syncing ? (
        <span>Syncing…</span>
      ) : lastPulledAt ? (
        <span>Synced {timeAgo(lastPulledAt)}</span>
      ) : (
        <span>Sync</span>
      )}
    </button>
  );
}

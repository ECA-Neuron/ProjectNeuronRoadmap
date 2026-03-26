"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import React from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

interface SyncState {
  syncing: boolean;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  error: string | null;
  triggerSync: () => void;
}

const SyncCtx = createContext<SyncState>({
  syncing: false,
  lastPulledAt: null,
  lastPushedAt: null,
  error: null,
  triggerSync: () => {},
});

export function LiveSyncProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [lastPulledAt, setLastPulledAt] = useState<string | null>(null);
  const [lastPushedAt, setLastPushedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const doSync = useCallback(async () => {
    if (!mountedRef.current) return;
    setSyncing(true);
    setError(null);

    try {
      const res = await fetch("/api/sync/auto");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Sync failed (${res.status})`);
      }

      const data = await res.json();
      if (!mountedRef.current) return;

      setLastPulledAt(data.lastPulledAt ?? null);
      setLastPushedAt(data.lastPushedAt ?? null);

      if (data.fresh && (data.pullSynced > 0 || data.pushSynced > 0)) {
        router.refresh();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, [router]);

  useEffect(() => {
    mountedRef.current = true;
    doSync();
    intervalRef.current = setInterval(doSync, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [doSync]);

  const value: SyncState = {
    syncing,
    lastPulledAt,
    lastPushedAt,
    error,
    triggerSync: doSync,
  };

  return React.createElement(SyncCtx.Provider, { value }, children);
}

export function useLiveSync() {
  return useContext(SyncCtx);
}

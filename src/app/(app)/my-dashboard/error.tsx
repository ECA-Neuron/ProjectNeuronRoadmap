"use client";

import { useEffect } from "react";

export default function MyDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("My Dashboard error:", error.message, error.digest);
  }, [error]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="max-w-md w-full rounded-xl border border-border/60 bg-card p-6 shadow-card space-y-4 text-center">
        <h2 className="text-lg font-semibold text-foreground">Dashboard failed to load</h2>
        <p className="text-sm text-muted-foreground">
          A temporary error occurred while rendering. Your data is safe — try refreshing.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center justify-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

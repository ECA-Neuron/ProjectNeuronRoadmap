"use client";

import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { AutosaveIndicator } from "@/components/autosave-indicator";
import { SyncStatus } from "@/components/sync-status";
import Link from "next/link";

const roleBadgeStyles: Record<string, string> = {
  ADMIN: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  MEMBER: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  VIEWER: "bg-gray-500/10 text-gray-500 dark:text-gray-400",
};

export function Header() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  return (
    <header className="fixed left-64 right-0 top-0 z-[90] flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-4">
        <span className="text-[13px] text-muted-foreground font-medium">
          Project Neuron Program Hub
        </span>
        <AutosaveIndicator />
        <SyncStatus />
      </div>
      <div className="flex items-center gap-3">
        {session?.user ? (
          <>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
                {(session.user.name || session.user.email || "?").charAt(0).toUpperCase()}
              </div>
              <span className="text-[13px] text-foreground font-medium">
                {session.user.name || session.user.email}
              </span>
              {role && (
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${roleBadgeStyles[role] || roleBadgeStyles.VIEWER}`}>
                  {role.charAt(0) + role.slice(1).toLowerCase()}
                </span>
              )}
            </div>
            <div className="w-px h-5 bg-border" />
            <Button
              variant="ghost"
              size="sm"
              className="text-[13px] text-muted-foreground hover:text-foreground h-8"
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            >
              Sign out
            </Button>
          </>
        ) : (
          <Link href="/auth/signin">
            <Button size="sm" className="h-8 text-[13px]">Sign in</Button>
          </Link>
        )}
      </div>
    </header>
  );
}

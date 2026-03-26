"use client";

import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { AutosaveIndicator } from "@/components/autosave-indicator";
import { SyncStatus } from "@/components/sync-status";
import Link from "next/link";

const roleBadgeStyles: Record<string, string> = {
  ADMIN: "bg-primary/10 text-primary",
  MEMBER: "bg-blue-500/10 text-blue-600",
  VIEWER: "bg-gray-500/10 text-gray-500",
};

export function Header() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  return (
    <header className="fixed left-64 right-0 top-0 z-[90] flex h-16 items-center justify-between border-b bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          Project Neuron Program Hub
        </span>
        <AutosaveIndicator />
        <SyncStatus />
      </div>
      <div className="flex items-center gap-4">
        {session?.user ? (
          <>
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              {session.user.name || session.user.email}
              {role && (
                <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${roleBadgeStyles[role] || roleBadgeStyles.VIEWER}`}>
                  {role.charAt(0) + role.slice(1).toLowerCase()}
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            >
              Sign out
            </Button>
          </>
        ) : (
          <Link href="/auth/signin">
            <Button size="sm">Sign in</Button>
          </Link>
        )}
      </div>
    </header>
  );
}

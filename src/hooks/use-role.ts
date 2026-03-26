"use client";

import { useSession } from "next-auth/react";

export function useRole() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "VIEWER";
  return {
    role,
    isAdmin: role === "ADMIN",
    canEdit: role === "ADMIN" || role === "MEMBER",
    isViewer: role === "VIEWER",
  };
}

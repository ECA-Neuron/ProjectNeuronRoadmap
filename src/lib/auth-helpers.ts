import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import type { Session } from "next-auth";
import type { UserRole } from "@/types/next-auth";

/**
 * Returns the current session or redirects to sign-in.
 * For use in server components and server actions.
 */
export async function requireAuth(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect("/auth/signin");
  }
  return session;
}

/**
 * Returns the current session if the user has one of the allowed roles.
 * Throws an error (for server actions) if unauthorized.
 */
export async function requireRole(allowed: UserRole[]): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error("Not authenticated");
  }
  if (!allowed.includes(session.user.role)) {
    throw new Error("Insufficient permissions");
  }
  return session;
}

/**
 * Returns true if the user can perform write operations (ADMIN or MEMBER).
 */
export function canEdit(session: Session | null): boolean {
  if (!session?.user) return false;
  return session.user.role === "ADMIN" || session.user.role === "MEMBER";
}

/**
 * Returns true if the user is an admin.
 */
export function isAdmin(session: Session | null): boolean {
  return session?.user?.role === "ADMIN";
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/roadmap", label: "Roadmap (FY26–FY28)", icon: "🗺️" },
  { href: "/admin", label: "Admin", icon: "⚙️", adminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const visibleItems = navItems.filter(
    (item) => !(item as { adminOnly?: boolean }).adminOnly || role === "ADMIN"
  );

  return (
    <aside className="fixed left-0 top-0 z-[100] h-screen w-64 border-r bg-card overflow-y-auto">
      <div className="flex h-16 items-center border-b px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5 font-bold text-lg">
          <span className="text-base">🧠</span>
          <span>Project Neuron</span>
        </Link>
      </div>
      <nav className="flex flex-col gap-0.5 p-3">
        {visibleItems.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <span className="text-xs">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

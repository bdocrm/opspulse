"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Megaphone, Users, UserCircle, BarChart3, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";

const defaultItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/agent-summaries", label: "Summaries", icon: Users },
  { href: "/settings", label: "Profile", icon: UserCircle },
];

const collectorItems = [
  { href: "/collector", label: "Dashboard", icon: BarChart3 },
  { href: "/collector/data-entry", label: "Entry", icon: ClipboardList },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/settings", label: "Profile", icon: UserCircle },
];

export function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role;

  const items = userRole === 'COLLECTOR' ? collectorItems : defaultItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t bg-card py-2 lg:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-col items-center gap-0.5 text-[10px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

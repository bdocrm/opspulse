"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Megaphone, Users, UserCircle, BarChart3, ClipboardList, Gauge } from "lucide-react";
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
  { href: "/performance/kpi", label: "KPI", icon: Gauge },
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
        const active = pathname === href || (href !== "/collector" && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "motion-control relative flex min-w-14 flex-col items-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-medium transition-[background-color,color,transform] duration-200 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none",
              active ? "text-primary" : "text-muted-foreground"
            )}
            aria-current={active ? "page" : undefined}
          >
            <span className={cn("absolute inset-x-3 -top-2 h-0.5 origin-center rounded-full bg-primary transition-transform duration-200", active ? "scale-x-100" : "scale-x-0")} aria-hidden="true" />
            <Icon className="h-5 w-5 transition-transform duration-200 motion-reduce:transition-none" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

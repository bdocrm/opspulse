"use client";

import { usePathname } from "next/navigation";

const appShellRoutes = [
  "/agent-summaries",
  "/agents",
  "/analytics",
  "/campaigns",
  "/collector",
  "/dashboard",
  "/dev/cleanup-database",
  "/manage-agents",
  "/manage-campaigns",
  "/manage-users",
  "/performance",
  "/production-monitoring",
  "/reports",
  "/settings",
];

export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hasDedicatedEntrance = pathname === "/login";
  const usesAppShell = appShellRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (usesAppShell) return <>{children}</>;

  return (
    <div
      key={pathname}
      className={hasDedicatedEntrance ? undefined : "motion-page-enter"}
      data-motion-page={hasDedicatedEntrance ? undefined : "true"}
    >
      {children}
    </div>
  );
}

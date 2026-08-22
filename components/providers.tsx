"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import ErrorBoundary from "@/components/error-boundary";
import { ToastProvider } from "@/components/toast-provider";
import { RouteTransition } from "@/components/motion/route-transition";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ToastProvider>
            <RouteTransition>{children}</RouteTransition>
          </ToastProvider>
        </ThemeProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string } = {}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  const label = mounted
    ? `Switch to ${isDark ? "Light" : "Dark"} Mode`
    : "Toggle color theme";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => { if (mounted) setTheme(isDark ? "light" : "dark"); }}
      aria-label={label}
      title={label}
      className={cn("relative transition-[background-color,border-color,color,transform] duration-300 ease-out active:scale-95 motion-reduce:transform-none motion-reduce:transition-none", className)}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-[opacity,transform] duration-300 ease-out dark:-rotate-180 dark:scale-75 dark:opacity-0 motion-reduce:transition-none" aria-hidden="true" />
      <Moon className="absolute h-5 w-5 rotate-180 scale-75 opacity-0 transition-[opacity,transform] duration-300 ease-out dark:rotate-0 dark:scale-100 dark:opacity-100 motion-reduce:transition-none" aria-hidden="true" />
    </Button>
  );
}

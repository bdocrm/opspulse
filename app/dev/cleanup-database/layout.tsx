import { AppShell } from "@/components/layout/app-shell";

export default function CleanupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

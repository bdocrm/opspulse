import { AppShell } from "@/components/layout/app-shell";

export default function CollectorLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

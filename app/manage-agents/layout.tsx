import { AppShell } from "@/components/layout/app-shell";

export default function ManageAgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}

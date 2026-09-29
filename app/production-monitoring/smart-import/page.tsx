import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canImport } from "@/lib/permissions";
import { SmartImportWizard } from "@/components/production-monitoring/smart-import-wizard";

export default async function SmartImportPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  if (!canImport(session.user.role)) redirect("/production-monitoring");
  return <SmartImportWizard />;
}

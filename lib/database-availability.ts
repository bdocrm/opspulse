export function databaseQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!/account or project has exceeded (?:the )?(?:compute time )?quota/i.test(message)) return null;
  return {
    code: "DATABASE_QUOTA_EXCEEDED",
    error: "Database temporarily unavailable: the provider quota has been exceeded. Imported files and campaign performance cannot be verified until database access is restored.",
  };
}

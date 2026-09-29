// Prefix untrusted formula-like strings so spreadsheet programs do not execute
// them when an exported error report is opened. Raw values remain in the batch.
export function csvCell(value: unknown) {
  let text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

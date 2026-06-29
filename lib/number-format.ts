/**
 * Format a number with thousand separators and decimals.
 * @param value - The numeric value to format
 * @param decimals - Number of decimal places (default 2)
 * @returns Formatted string with commas
 */
export function formatNumberWithCommas(value: number | string, decimals = 2): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Remove thousand separators and return numeric value.
 * @param formatted - A formatted string (e.g., "1,000.00")
 * @returns Numeric value
 */
export function parseFormattedNumber(formatted: string): number {
  return parseFloat(formatted.replace(/,/g, ''));
}

/**
 * Format for display in the UI (no decimal enforcement, just commas).
 * @param value - The numeric value
 * @returns Formatted string with commas
 */
export function formatForDisplay(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return num.toLocaleString('en-US');
}

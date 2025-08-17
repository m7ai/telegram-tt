/**
 * Utility functions for number formatting
 */

/**
 * Formats numbers with condensed notation (K, M, B), commas, and appropriate decimal places
 *
 * @param value - The number to format (can be string, number, undefined, or null)
 * @returns Formatted string representation of the number
 *
 * @example
 * formatNumber(1234) // "1,234.00"
 * formatNumber(1234567) // "1.23M"
 * formatNumber(0.000123) // "0.000123"
 * formatNumber(null) // "N/A"
 */
export function formatNumber(
  value: string | number | undefined | null
): string {
  if (!value && value !== 0) return "N/A";

  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "N/A";

  // Handle negative numbers
  const isNegative = num < 0;
  const absNum = Math.abs(num);

  // Format based on magnitude
  let formatted = "";

  if (absNum >= 1_000_000_000) {
    // Billions
    formatted = (absNum / 1_000_000_000).toFixed(2) + "B";
  } else if (absNum >= 1_000_000) {
    // Millions
    formatted = (absNum / 1_000_000).toFixed(2) + "M";
  } else if (absNum >= 1_000) {
    // Thousands
    formatted = (absNum / 1_000).toFixed(2) + "K";
  } else if (absNum >= 1) {
    // Regular numbers with 2 decimal places
    formatted = absNum.toFixed(2);
  } else if (absNum > 0) {
    // Small decimals - keep more precision
    formatted = absNum.toFixed(6).replace(/\.?0+$/, "");
  } else {
    // Zero
    formatted = "0";
  }

  // Remove unnecessary trailing zeros and decimal points for condensed notation
  if (
    formatted.includes("K") ||
    formatted.includes("M") ||
    formatted.includes("B")
  ) {
    formatted = formatted.replace(/\.00([KMB])$/, "$1");
  }

  // Add commas for regular numbers (not condensed)
  if (
    !formatted.includes("K") &&
    !formatted.includes("M") &&
    !formatted.includes("B")
  ) {
    const parts = formatted.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    formatted = parts.join(".");
  }

  return isNegative ? "-" + formatted : formatted;
}

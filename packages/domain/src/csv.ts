export interface Column<T> { header: string; value: (row: T) => string | number | null | undefined | Date }

/**
 * RFC 4180 CSV that opens correctly in Excel with Arabic text:
 * - UTF-8 byte-order mark so Excel detects the encoding
 * - CRLF line endings, quotes doubled
 * - CSV-injection guard: cells starting with = + - @ tab or CR are prefixed with ' so spreadsheet apps never execute them
 */
export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

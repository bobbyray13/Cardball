/**
 * Minimal CSV reader (RFC 4180 flavour) — no external dependency.
 *
 * Handles quoted fields, `""` escapes, commas / newlines inside quotes,
 * CRLF and lone-CR line endings, a leading UTF-8 BOM (the Lahman release notes
 * mention that some files gained byte-order markers) and blank lines.
 */

export interface CsvTable {
  header: string[];
  rows: string[][];
}

/** Parses CSV text into raw records (no header handling). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = text.length > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;

  const endField = (): void => {
    row.push(field);
    field = '';
  };

  const endRow = (): void => {
    endField();
    // Drop blank lines (a lone empty field with no separator).
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Parses CSV text into a header + positional rows (fast for big files). */
export function parseCsvTable(text: string): CsvTable {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined) return { header: [], rows: [] };
  return { header: header.map((h) => h.trim()), rows: rows.slice(1) };
}

/**
 * Resolves the column positions of the named columns, failing loudly if any are
 * missing so a changed upstream format cannot silently produce empty stats.
 * The return type keeps the literal column names, so lookups are checked.
 */
export function requireColumns<const T extends readonly string[]>(
  table: CsvTable,
  names: T,
  fileName: string,
): { [K in T[number]]: number } {
  const index: Record<string, number> = {};
  for (const name of names) {
    const at = table.header.indexOf(name);
    if (at < 0) {
      throw new Error(
        `${fileName}: missing expected column "${name}". Header was: ${table.header.join(',')}`,
      );
    }
    index[name] = at;
  }
  return index as { [K in T[number]]: number };
}

export function cell(row: readonly string[], index: number): string {
  const value = row[index];
  return value === undefined ? '' : value;
}

/** Blank cells count as 0 in the Lahman files. */
export function num(value: string | undefined): number {
  if (value === undefined) return 0;
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function optionalText(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export function firstCharOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed.slice(0, 1);
}

/** Lahman dates look like `2004-04-02`; blank means "never appeared". */
export function yearFromDate(value: string | undefined): number | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  const match = /^(\d{4})/.exec(trimmed);
  if (match === null) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

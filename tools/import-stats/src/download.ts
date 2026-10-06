/**
 * Downloads (and caches) the Lahman-format source CSVs.
 *
 * Source: the SABR/Sean Lahman Baseball Database, 2025 release (seasons
 * 1871-2025), read from an unofficial GitHub CSV mirror of that release.
 *
 * The Chadwick Bureau repo the task originally pointed at
 * (`chadwickbureau/baseballdatabank`) no longer exists — GitHub returns 404 for
 * both the repo and its raw files — and SABR now publishes the database through
 * Box share links that cannot be fetched anonymously. This mirror carries the
 * same Lahman tables and columns (verified by header check at import time).
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DATA_SOURCE = {
  name: 'Sean Lahman Baseball Database (Lahman format) — 2025 release',
  release: 'Version 2025 (released 2026-01-02), seasons 1871-2025',
  official: 'https://sabr.org/lahman-database/',
  mirrorRepo: 'https://github.com/cbwinslow/lahman-database-csv',
  rawBase: 'https://raw.githubusercontent.com/cbwinslow/lahman-database-csv/main/data',
  license: 'CC BY-SA 3.0 (data); public domain in the US as factual data',
  note: 'Unofficial CSV mirror of the official SABR release. The historical Chadwick Bureau baseballdatabank repo now 404s, and SABR serves the official zips through Box, which has no anonymous download API.',
} as const;

export const CACHE_DIR = fileURLToPath(new URL('../.cache/', import.meta.url));

export const CSV_FILES = [
  'People.csv',
  'Batting.csv',
  'Pitching.csv',
  'Fielding.csv',
  'FieldingOF.csv',
  'FieldingOFsplit.csv',
  'Appearances.csv',
] as const;

export type CsvFileName = (typeof CSV_FILES)[number];

export type CsvFileMap = Record<CsvFileName, string>;

export interface LoadOptions {
  /** Re-download even when a cached copy exists. */
  refresh?: boolean;
  log?: (message: string) => void;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function download(url: string, destination: string): Promise<number> {
  const response = await fetch(url, { headers: { 'user-agent': 'cardball-import-stats' } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
  return bytes.byteLength;
}

/**
 * Returns the text of every source CSV, downloading only what is missing from
 * `tools/import-stats/.cache/` (unless `refresh` is set).
 */
export async function loadCsvFiles(options: LoadOptions = {}): Promise<CsvFileMap> {
  const log = options.log ?? ((): void => undefined);
  await mkdir(CACHE_DIR, { recursive: true });

  const files: Partial<CsvFileMap> = {};
  for (const name of CSV_FILES) {
    const path = `${CACHE_DIR}${name}`;
    const cached = !options.refresh && (await exists(path));
    if (cached) {
      log(`cache hit   ${name}`);
    } else {
      const url = `${DATA_SOURCE.rawBase}/${name}`;
      const bytes = await download(url, path);
      log(`downloaded  ${name} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
    }
    const text = await readFile(path, 'utf8');
    files[name] = stripBom(text);
  }

  return files as CsvFileMap;
}

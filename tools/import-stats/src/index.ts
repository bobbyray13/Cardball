/**
 * Cardball MLB stats importer.
 *
 * Downloads the Lahman-format source CSVs (cached in `tools/import-stats/.cache/`),
 * merges them into one row per (player, season) and upserts everything into the
 * dev Postgres database. Safe to re-run: people are upserted on `bbref_id` and
 * seasons on `(person_id, year)`.
 *
 *   pnpm import:stats                     # from the repo root
 *   pnpm import:stats -- --refresh        # re-download the source CSVs first
 *   pnpm import:stats -- --dry-run        # parse only, touch no database
 *
 * `DATABASE_URL` overrides the connection string.
 */
import { createDb } from '@cardball/db';
import { DATA_SOURCE, loadCsvFiles } from './download.js';
import { buildDataset, summarizeDataset } from './transform.js';
import { writeDataset } from './writer.js';

const DEFAULT_DATABASE_URL = 'postgres://cardball:cardball@localhost:5433/cardball';

interface CliOptions {
  refresh: boolean;
  dryRun: boolean;
}

function printUsage(): void {
  console.log(`Usage: pnpm --filter @cardball/import-stats dev [options]

  --refresh   re-download the source CSVs (default: reuse .cache/)
  --dry-run   parse and report, write nothing to Postgres
  -h, --help  show this message`);
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { refresh: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--refresh') options.refresh = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}\n`);
      printUsage();
      process.exit(1);
    }
  }
  return options;
}

function redact(url: string): string {
  return url.replace(/:\/\/([^:@/]+):[^@/]+@/, '://$1:***@');
}

function log(message: string): void {
  console.log(message);
}

async function main(): Promise<void> {
  const started = Date.now();
  const options = parseArgs(process.argv.slice(2));

  log(`Source: ${DATA_SOURCE.name} — ${DATA_SOURCE.release}`);
  log(`Mirror: ${DATA_SOURCE.mirrorRepo} (${DATA_SOURCE.rawBase})`);
  log('');

  const files = await loadCsvFiles({ refresh: options.refresh, log });
  log('');

  const dataset = buildDataset(files, { log });
  const summary = summarizeDataset(dataset);
  log('');
  log(
    `Parsed ${summary.people} people (${summary.peopleRows} People.csv rows), ` +
      `${summary.seasons} player-seasons (${summary.minYear}-${summary.maxYear}), ` +
      `${summary.starters} flagged as starters`,
  );

  if (options.dryRun) {
    log('--dry-run: nothing written to the database.');
    return;
  }

  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  log(`Database: ${redact(url)}`);
  const { db, sql: client } = createDb(url);

  try {
    const result = await writeDataset(db, dataset, { log });
    if (result.skippedSeasons > 0) {
      log(`  note: ${result.skippedSeasons} seasons had no matching person row`);
    }

    const rows = await client<
      {
        people: number;
        seasons: number;
        min_year: number | null;
        max_year: number | null;
        starters: number;
      }[]
    >`select
        (select count(*) from people)::int as people,
        (select count(*) from seasons)::int as seasons,
        (select min(year) from seasons)::int as min_year,
        (select max(year) from seasons)::int as max_year,
        (select count(*) from people where is_starter)::int as starters`;
    const totals = rows[0];
    if (totals !== undefined) {
      log('');
      log(
        `Database totals: ${totals.people} people, ${totals.seasons} seasons ` +
          `(${totals.min_year}-${totals.max_year}), ${totals.starters} starters`,
      );
    }
  } finally {
    await client.end();
  }

  log(`Finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

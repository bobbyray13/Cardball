/**
 * Idempotent bulk writes into Postgres: upsert people on `bbref_id`, then
 * seasons on `(person_id, year)`, both in ~1000-row batches.
 */
import { people as peopleTable, seasons as seasonsTable, type Db } from '@cardball/db';
import { sql } from 'drizzle-orm';
import { preferPerson } from './merge.js';
import type { ParsedDataset, PersonSeed, SeasonSeed } from './types.js';

const PEOPLE_BATCH = 1000;
const SEASONS_BATCH = 1000;

export interface WriteResult {
  people: number;
  seasons: number;
  skippedSeasons: number;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toPersonRow(person: PersonSeed) {
  return {
    bbrefId: person.bbrefId,
    nameFirst: person.nameFirst,
    nameLast: person.nameLast,
    nameGiven: person.nameGiven,
    bats: person.bats,
    throws: person.throws,
    debutYear: person.debutYear,
    finalYear: person.finalYear,
    isStarter: person.isStarter,
  };
}

function toSeasonRow(season: SeasonSeed, personId: number) {
  return {
    personId,
    year: season.year,
    teamLabel: season.teamLabel,
    games: season.games,
    ab: season.ab,
    h: season.h,
    avg: season.avg,
    doubles: season.doubles,
    triples: season.triples,
    homeRuns: season.homeRuns,
    rbi: season.rbi,
    sb: season.sb,
    pa: season.pa,
    pitchGames: season.pitchGames,
    pitchIpOuts: season.pitchIpOuts,
    pitchEra: season.pitchEra,
    pitchBf: season.pitchBf,
    primaryPosition: season.primaryPosition,
    positionsPlayed: season.positionsPlayed,
  };
}

export async function writeDataset(
  db: Db['db'],
  dataset: ParsedDataset,
  options: { log?: (message: string) => void } = {},
): Promise<WriteResult> {
  const log = options.log ?? ((): void => undefined);

  // Upsert people on bbref_id, deduplicating defensively (a duplicate would make
  // Postgres refuse the batch: "ON CONFLICT DO UPDATE cannot affect row twice").
  const peopleByBbref = new Map<string, PersonSeed>();
  for (const person of dataset.people) {
    const existing = peopleByBbref.get(person.bbrefId);
    peopleByBbref.set(person.bbrefId, existing === undefined ? person : preferPerson(existing, person));
  }
  const personRows = [...peopleByBbref.values()];

  const idByBbref = new Map<string, number>();
  let written = 0;
  for (const batch of chunks(personRows, PEOPLE_BATCH)) {
    const returned = await db
      .insert(peopleTable)
      .values(batch.map(toPersonRow))
      .onConflictDoUpdate({
        target: peopleTable.bbrefId,
        set: {
          nameFirst: sql`excluded.name_first`,
          nameLast: sql`excluded.name_last`,
          nameGiven: sql`excluded.name_given`,
          bats: sql`excluded.bats`,
          throws: sql`excluded.throws`,
          debutYear: sql`excluded.debut_year`,
          finalYear: sql`excluded.final_year`,
          isStarter: sql`excluded.is_starter`,
        },
      })
      .returning({ id: peopleTable.id, bbrefId: peopleTable.bbrefId });

    for (const row of returned) idByBbref.set(row.bbrefId, row.id);
    written += batch.length;
    if (written % (PEOPLE_BATCH * 10) === 0 || written === personRows.length) {
      log(`people   ${written}/${personRows.length}`);
    }
  }

  const seasonRows = new Map<string, ReturnType<typeof toSeasonRow>>();
  let skippedSeasons = 0;
  for (const season of dataset.seasons) {
    const personId = idByBbref.get(season.bbrefId);
    if (personId === undefined) {
      skippedSeasons += 1;
      continue;
    }
    const key = `${personId}|${season.year}`;
    const row = toSeasonRow(season, personId);
    const existing = seasonRows.get(key);
    // Two People.csv rows can share a bbrefID; keep the fuller season.
    seasonRows.set(key, existing === undefined || row.games > existing.games ? row : existing);
  }

  const rows = [...seasonRows.values()];
  let seasonsWritten = 0;
  for (const batch of chunks(rows, SEASONS_BATCH)) {
    await db
      .insert(seasonsTable)
      .values(batch)
      .onConflictDoUpdate({
        target: [seasonsTable.personId, seasonsTable.year],
        set: {
          teamLabel: sql`excluded.team_label`,
          games: sql`excluded.games`,
          ab: sql`excluded.ab`,
          h: sql`excluded.h`,
          avg: sql`excluded.avg`,
          doubles: sql`excluded.doubles`,
          triples: sql`excluded.triples`,
          homeRuns: sql`excluded.home_runs`,
          rbi: sql`excluded.rbi`,
          sb: sql`excluded.sb`,
          pa: sql`excluded.pa`,
          pitchGames: sql`excluded.pitch_games`,
          pitchIpOuts: sql`excluded.pitch_ip_outs`,
          pitchEra: sql`excluded.pitch_era`,
          pitchBf: sql`excluded.pitch_bf`,
          primaryPosition: sql`excluded.primary_position`,
          positionsPlayed: sql`excluded.positions_played`,
        },
      });
    seasonsWritten += batch.length;
    if (seasonsWritten % (SEASONS_BATCH * 10) === 0 || seasonsWritten === rows.length) {
      log(`seasons  ${seasonsWritten}/${rows.length}`);
    }
  }

  return { people: idByBbref.size, seasons: seasonsWritten, skippedSeasons };
}

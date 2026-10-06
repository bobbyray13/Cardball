import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  varchar,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Position, SavedLineup, SeasonStats } from '@cardball/shared';

// ---------------------------------------------------------------------------
// Stats database (imported from the Baseball Databank)
// ---------------------------------------------------------------------------

export const people = pgTable(
  'people',
  {
    id: serial('id').primaryKey(),
    /** Baseball-Reference player id, e.g. "troutmi01" */
    bbrefId: varchar('bbref_id', { length: 16 }).notNull(),
    nameFirst: text('name_first').notNull(),
    nameLast: text('name_last').notNull(),
    nameGiven: text('name_given'),
    bats: varchar('bats', { length: 1 }),
    throws: varchar('throws', { length: 1 }),
    debutYear: integer('debut_year'),
    finalYear: integer('final_year'),
    /** career: ever pitched more than 100 innings in a single MLB season */
    isStarter: boolean('is_starter').notNull().default(false),
  },
  (t) => [uniqueIndex('people_bbref_id_idx').on(t.bbrefId), index('people_name_idx').on(t.nameLast, t.nameFirst)],
);

export const seasons = pgTable(
  'seasons',
  {
    id: serial('id').primaryKey(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    teamLabel: text('team_label').notNull().default(''),

    games: integer('games').notNull().default(0),

    ab: integer('ab').notNull().default(0),
    h: integer('h').notNull().default(0),
    avg: doublePrecision('avg'),
    doubles: integer('doubles').notNull().default(0),
    triples: integer('triples').notNull().default(0),
    homeRuns: integer('home_runs').notNull().default(0),
    rbi: integer('rbi').notNull().default(0),
    sb: integer('sb').notNull().default(0),
    pa: integer('pa').notNull().default(0),

    pitchGames: integer('pitch_games').notNull().default(0),
    pitchIpOuts: integer('pitch_ip_outs').notNull().default(0),
    pitchEra: doublePrecision('pitch_era'),
    pitchBf: integer('pitch_bf').notNull().default(0),

    primaryPosition: varchar('primary_position', { length: 3 }),
    positionsPlayed: jsonb('positions_played')
      .$type<{ position: Position; games: number; rating: number }[]>()
      .notNull()
      .default([]),
  },
  (t) => [
    uniqueIndex('seasons_person_year_idx').on(t.personId, t.year),
    index('seasons_year_idx').on(t.year),
  ],
);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    isAdmin: boolean('is_admin').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha-256 of the session token
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  createdByUserId: integer('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  usedByUserId: integer('used_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Cards & collections
// ---------------------------------------------------------------------------

export const photos = pgTable('photos', {
  id: serial('id').primaryKey(),
  ownerId: integer('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mime: text('mime').notNull().default('image/jpeg'),
  width: integer('width').notNull().default(0),
  height: integer('height').notNull().default(0),
  sizeBytes: integer('size_bytes').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** A catalog "card": real player + the year it was printed (+ optional set/rarity). */
export const cardModels = pgTable(
  'card_models',
  {
    id: serial('id').primaryKey(),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    cardYear: integer('card_year').notNull(),
    setLabel: text('set_label').notNull().default(''),
    rarity: text('rarity'),
    /** how this model came to exist: user photo entry, database search, or import seed */
    source: text('source').notNull().default('database'),
    createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('card_models_person_year_set_idx').on(t.personId, t.cardYear, t.setLabel)],
);

/** One entry in a user's collection. */
export const userCards = pgTable(
  'user_cards',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardModelId: integer('card_model_id')
      .notNull()
      .references(() => cardModels.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    photoId: integer('photo_id').references(() => photos.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('user_cards_user_idx').on(t.userId), index('user_cards_model_idx').on(t.cardModelId)],
);

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/** Re-exported for callers that only depend on this package. */
export type { SavedLineup };

export const teams = pgTable(
  'teams',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    primaryColor: text('primary_color'),
    /** saved default lineup, keyed by team_cards.id (as strings) */
    lineup: jsonb('lineup').$type<SavedLineup | null>(),
    /**
     * Set on a team built from a tournament draft. Its lineup may start a
     * fielder out of position, since its manager couldn't pick the roster.
     */
    tournamentId: integer('tournament_id').references((): AnyPgColumn => tournaments.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('teams_user_idx').on(t.userId)],
);

export const teamCards = pgTable(
  'team_cards',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userCardId: integer('user_card_id')
      .notNull()
      .references(() => userCards.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('team_cards_unique_idx').on(t.teamId, t.userCardId)],
);

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export const games = pgTable(
  'games',
  {
    id: serial('id').primaryKey(),
    mode: text('mode').notNull().default('remote'), // remote | hotseat | bot
    regulationInnings: integer('regulation_innings').notNull().default(9),
    homeUserId: integer('home_user_id').references(() => users.id, { onDelete: 'set null' }),
    awayUserId: integer('away_user_id').references(() => users.id, { onDelete: 'set null' }),
    homeTeamId: integer('home_team_id').references(() => teams.id, { onDelete: 'set null' }),
    awayTeamId: integer('away_team_id').references(() => teams.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('lobby'), // lobby | live | finished
    /** what cards this match allows: era range + rarity caps, null = anything */
    matchRules: jsonb('match_rules'),
    winnerSide: text('winner_side'), // home | away
    /** optimistic-concurrency counter, bumped on every applied action */
    version: integer('version').notNull().default(0),
    state: jsonb('state').notNull(),
    discordInviteUrl: text('discord_invite_url'),
    /** set when a tournament scheduled this game, so its other managers can watch */
    tournamentId: integer('tournament_id').references((): AnyPgColumn => tournaments.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('games_status_idx').on(t.status), index('games_home_user_idx').on(t.homeUserId), index('games_away_user_idx').on(t.awayUserId)],
);

export const gameEvents = pgTable(
  'game_events',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    inning: integer('inning').notNull(),
    half: text('half').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    data: jsonb('data'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('game_events_game_seq_idx').on(t.gameId, t.seq)],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('chat_messages_game_idx').on(t.gameId)],
);

// ---------------------------------------------------------------------------
// Drafts (M3) — pass-the-pack draft sessions
// ---------------------------------------------------------------------------

export const drafts = pgTable('drafts', {
  id: serial('id').primaryKey(),
  hostUserId: integer('host_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('lobby'), // lobby | active | finished
  config: jsonb('config').notNull(),
  state: jsonb('state').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const draftParticipants = pgTable(
  'draft_participants',
  {
    id: serial('id').primaryKey(),
    draftId: integer('draft_id')
      .notNull()
      .references(() => drafts.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seat: integer('seat').notNull(),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('draft_participants_idx').on(t.draftId, t.userId)],
);

// ---------------------------------------------------------------------------
// League settings — the commissioner's house rules
// ---------------------------------------------------------------------------

/**
 * A single row (id 1) holds the league's house rules. Games snapshot a copy
 * when they are created, so a change here never alters a game in progress.
 */
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  houseRules: jsonb('house_rules').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
});

/**
 * A tournament: three or four managers draft once, then play it off. The
 * tournament owns its draft room, and the cards each manager drafts become
 * their tournament team.
 */
export const tournaments = pgTable('tournaments', {
  id: serial('id').primaryKey(),
  hostUserId: integer('host_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('lobby'), // lobby | drafting | playing | finished
  /** format, seats, innings, auto-simulate, and the draft's settings */
  config: jsonb('config').notNull(),
  /** the draft room, the schedule, the teams, and the log */
  state: jsonb('state').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

export type PersonRow = typeof people.$inferSelect;export type SeasonRow = typeof seasons.$inferSelect;
export type CardModelRow = typeof cardModels.$inferSelect;
export type UserCardRow = typeof userCards.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type GameEventRow = typeof gameEvents.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;
export type DraftRow = typeof drafts.$inferSelect;
export type DraftParticipantRow = typeof draftParticipants.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type TournamentRow = typeof tournaments.$inferSelect;

/** DB row → engine-facing SeasonStats. */
export function seasonRowToStats(row: SeasonRow): SeasonStats {
  const pitched = row.pitchGames > 0 || row.pitchIpOuts > 0 || row.pitchBf > 0;
  return {
    year: row.year,
    teamLabel: row.teamLabel,
    games: row.games,
    ab: row.ab,
    h: row.h,
    avg: row.avg,
    doubles: row.doubles,
    triples: row.triples,
    homeRuns: row.homeRuns,
    rbi: row.rbi,
    sb: row.sb,
    pa: row.pa,
    pitching: pitched
      ? { games: row.pitchGames, ipOuts: row.pitchIpOuts, era: row.pitchEra }
      : null,
    primaryPosition: (row.primaryPosition as Position | null) ?? null,
    positionsPlayed: row.positionsPlayed ?? [],
  };
}

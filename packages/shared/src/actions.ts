/**
 * Game actions: every move a manager can make during a game.
 * The server validates actions with these zod schemas before handing them to
 * the engine; the engine consumes the inferred types.
 *
 * Player ids are engine-internal strings (stable per game), so the wire
 * format is tiny and serializable.
 */

import { z } from 'zod';

export const playerIdSchema = z.string().min(1);
export const sideSchema = z.enum(['home', 'away']);
export const positionSchema = z.enum(['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P']);

/** Lobby only: (re)write a team's full lineup, 9 spots, before the game starts. */
export const setLineupActionSchema = z.object({
  type: z.literal('set-lineup'),
  side: sideSchema,
  lineup: z.array(playerIdSchema).length(9),
  fieldPositions: z.record(positionSchema, playerIdSchema),
  startingPitcherId: playerIdSchema,
});
export type SetLineupAction = z.infer<typeof setLineupActionSchema>;

/** Lobby only: managers agree on a fielding rating for a player. */
export const setFieldingOverrideActionSchema = z.object({
  type: z.literal('set-fielding-override'),
  side: sideSchema,
  playerId: playerIdSchema,
  position: positionSchema,
  rating: z.number().int().min(-3).max(3),
});

/** Lobby → live: roll for home team, lock lineups, begin the game. */
export const startGameActionSchema = z.object({ type: z.literal('start-game') });

/**
 * Replace a position player. Context-sensitive legality is checked by the engine:
 * pinch-hitter (out = due batter, pre-at-bat), pinch-runner (out = runner on base),
 * or a defensive lineup substitution.
 */
export const substituteActionSchema = z.object({
  type: z.literal('substitute'),
  outPlayerId: playerIdSchema,
  inPlayerId: playerIdSchema,
  /** field position for the incoming player; defaults to the outgoing player's */
  fieldPosition: positionSchema.optional(),
});
export type SubstituteAction = z.infer<typeof substituteActionSchema>;

/** Defense: bring in a new pitcher (role and cap are derived from game context). */
export const pitcherChangeActionSchema = z.object({
  type: z.literal('pitcher-change'),
  inPlayerId: playerIdSchema,
});

/** Offense, pre-at-bat: runner attempts to steal the next base (2nd or 3rd). */
export const attemptStealActionSchema = z.object({
  type: z.literal('attempt-steal'),
  runnerId: playerIdSchema,
});

/** Offense, pre-at-bat: resolve this plate appearance's pitch rolls. */
export const throwPitchActionSchema = z.object({ type: z.literal('throw-pitch') });

/** Defense, after fielding a force grounder: gamble on the double play or take the out. */
export const dpAttemptActionSchema = z.object({
  type: z.literal('dp-attempt'),
  attempt: z.boolean(),
});

/** Offense: send (or hold) the lead runner on a hit or a tag-up opportunity. */
export const sendRunnerActionSchema = z.object({
  type: z.literal('send-runner'),
  send: z.boolean(),
});

/** Either manager: concede the game. */
export const concedeActionSchema = z.object({
  type: z.literal('concede'),
  /** conceding side; required in hotseat where one user manages both */
  side: sideSchema.optional(),
});

export const gameActionSchema = z.discriminatedUnion('type', [
  setLineupActionSchema,
  setFieldingOverrideActionSchema,
  startGameActionSchema,
  substituteActionSchema,
  pitcherChangeActionSchema,
  attemptStealActionSchema,
  throwPitchActionSchema,
  dpAttemptActionSchema,
  sendRunnerActionSchema,
  concedeActionSchema,
]);

export type GameAction = z.infer<typeof gameActionSchema>;

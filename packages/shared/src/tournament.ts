/**
 * Tournaments: a handful of managers draft once, then play it off.
 *
 * Three or four managers take seats, run one shared draft (more packs than a
 * friendly draft, because these cards have to field a whole tournament), and
 * the cards they draft become their tournament team — nothing else. From there
 * it is either a round robin or a bracket with semifinals, a final, and a third
 * place game.
 *
 * The schedule is a plan, not a result: a match's slots are seeds until the
 * earlier matches decide them, so the bracket fills itself in as games end.
 */

import type { PackThemeId } from './packs.js';

export type TournamentFormat = 'round-robin' | 'semis';
export type TournamentStatus = 'lobby' | 'drafting' | 'playing' | 'finished';

/** The draft a tournament runs before it plays. */
export interface TournamentDraftConfig {
  rounds: number;
  packSize: number;
  yearFrom: number;
  yearTo: number;
  themes: PackThemeId[];
  rarityCaps: { rare: number; star: number; mythic: number } | null;
}

export interface TournamentConfig {
  format: TournamentFormat;
  seats: number;
  regulationInnings: number;
  /** play each match the moment it is scheduled instead of waiting for managers */
  autoSimulate: boolean;
  draft: TournamentDraftConfig;
}

export const TOURNAMENT_LIMITS = {
  minSeats: 3,
  maxSeats: 4,
  minRounds: 1,
  maxRounds: 8,
  minPackSize: 4,
  maxPackSize: 12,
  /** fewest cards a manager may leave the draft with, enough to field nine and keep a bench */
  minPicks: 12,
} as const;

/** Where a team in a match comes from: a seed, or an earlier result. */
export type MatchSlot = { seed: number } | { winnerOf: string } | { loserOf: string };

export interface TournamentMatch {
  id: string;
  /** what the match is called on the bracket */
  stage: string;
  /** the plan for each side */
  home: MatchSlot;
  away: MatchSlot;
  /** the seats, once both slots are known */
  homeSeat: number | null;
  awaySeat: number | null;
  gameId: number | null;
  winnerSeat: number | null;
  loserSeat: number | null;
  /** set when this match couldn't be scheduled at all */
  error: string | null;
  /** decided without a game: the other side couldn't field nine */
  forfeit?: boolean;
}

export interface TournamentSeatView {
  userId: number;
  name: string;
  seat: number;
  isHost: boolean;
  /** the team built from this manager's draft picks */
  teamId: number | null;
  teamName: string | null;
  wins: number;
  losses: number;
  runsFor: number;
  runsAgainst: number;
}

export interface TournamentView {
  id: number;
  name: string;
  status: TournamentStatus;
  config: TournamentConfig;
  hostUserId: number;
  seats: TournamentSeatView[];
  matches: TournamentMatch[];
  /** decided matches' final lines, keyed by match id */
  scores: Record<string, MatchScore>;
  draftId: number | null;
  championSeat: number | null;
  log: { seq: number; text: string }[];
  updatedAt: string;
}

export interface TournamentListItem {
  id: number;
  name: string;
  status: TournamentStatus;
  format: TournamentFormat;
  seats: number;
  seatsFilled: number;
  hostName: string;
  era: string;
  championName: string | null;
  isMine: boolean;
  updatedAt: string;
}

/** "1961–1992", for the room list. */
export function tournamentEraLabel(draft: TournamentDraftConfig): string {
  return draft.yearFrom === draft.yearTo ? `${draft.yearFrom}` : `${draft.yearFrom}–${draft.yearTo}`;
}

export function formatLabel(format: TournamentFormat): string {
  return format === 'semis' ? 'Semifinals, final, and third place' : 'Round robin';
}

/**
 * The plan for a tournament. Seeds are zero-based seat numbers, and a bracket
 * with three managers gives the top seed a bye into the final.
 */
export function scheduleMatches(format: TournamentFormat, seats: number): TournamentMatch[] {
  const match = (id: string, stage: string, home: MatchSlot, away: MatchSlot): TournamentMatch => ({
    id,
    stage,
    home,
    away,
    homeSeat: null,
    awaySeat: null,
    gameId: null,
    winnerSeat: null,
    loserSeat: null,
    error: null,
  });

  if (format === 'round-robin') {
    const out: TournamentMatch[] = [];
    for (let a = 0; a < seats; a++) {
      for (let b = a + 1; b < seats; b++) out.push(match(`rr-${a}-${b}`, 'Round robin', { seed: a }, { seed: b }));
    }
    return out;
  }

  if (seats < 4) {
    // Three managers: the top seed waits, the other two play for the other seat.
    return [
      match('semi-1', 'Semifinal', { seed: 1 }, { seed: 2 }),
      match('final', 'Final', { winnerOf: 'semi-1' }, { seed: 0 }),
    ];
  }
  return [
    match('semi-1', 'Semifinal A', { seed: 0 }, { seed: 3 }),
    match('semi-2', 'Semifinal B', { seed: 1 }, { seed: 2 }),
    match('third', 'Third place', { loserOf: 'semi-1' }, { loserOf: 'semi-2' }),
    match('final', 'Final', { winnerOf: 'semi-1' }, { winnerOf: 'semi-2' }),
  ];
}

/** Resolve a slot against the results so far; null while it is still unknown. */
export function slotSeat(slot: MatchSlot, decided: Map<string, TournamentMatch>): number | null {
  if ('seed' in slot) return slot.seed;
  if ('winnerOf' in slot) {
    const from = decided.get(slot.winnerOf);
    return from ? from.winnerSeat : null;
  }
  const from = decided.get(slot.loserOf);
  return from ? from.loserSeat : null;
}

/** A decided match's final line. */
export interface MatchScore {
  home: number;
  away: number;
  winner: 'home' | 'away';
}

export interface SeatRecord {
  seat: number;
  wins: number;
  losses: number;
  runsFor: number;
  runsAgainst: number;
}

/** The standings, worked out from the decided matches alone. */
export function standingsFrom(seatCount: number, matches: TournamentMatch[], scoreOf: (matchId: string) => MatchScore | null): SeatRecord[] {
  const table: SeatRecord[] = Array.from({ length: seatCount }, (_, seat) => ({ seat, wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 }));
  for (const match of matches) {
    if (match.winnerSeat === null || match.homeSeat === null || match.awaySeat === null) continue;
    const score = scoreOf(match.id);
    if (!score && !match.forfeit) continue;
    const home = table[match.homeSeat];
    const away = table[match.awaySeat];
    const winner = table[match.winnerSeat];
    const loser = table[match.winnerSeat === match.homeSeat ? match.awaySeat : match.homeSeat];
    if (winner) winner.wins += 1;
    if (loser) loser.losses += 1;
    if (!score) continue;
    if (home) {
      home.runsFor += score.home;
      home.runsAgainst += score.away;
    }
    if (away) {
      away.runsFor += score.away;
      away.runsAgainst += score.home;
    }
  }
  return table;
}

/**
 * Who wins it: the final's winner in a bracket, and in a round robin the best
 * record, then run differential, then the earlier seat.
 */
export function championSeat(
  format: TournamentFormat,
  seatCount: number,
  matches: TournamentMatch[],
  scoreOf: (matchId: string) => MatchScore | null,
): number | null {
  if (matches.length === 0) return null;
  if (format === 'semis') return matches.find((m) => m.id === 'final')?.winnerSeat ?? null;
  const table = standingsFrom(seatCount, matches, scoreOf);
  const ranked = [...table].sort((a, b) => b.wins - a.wins || b.runsFor - b.runsAgainst - (a.runsFor - a.runsAgainst) || a.seat - b.seat);
  const best = ranked[0];
  return best && best.wins > 0 ? best.seat : null;
}

/** The standings line for a seat, e.g. "2–1, +7". */
export function recordLabel(seat: TournamentSeatView): string {
  const diff = seat.runsFor - seat.runsAgainst;
  return `${seat.wins}–${seat.losses}, ${diff >= 0 ? '+' : ''}${diff}`;
}

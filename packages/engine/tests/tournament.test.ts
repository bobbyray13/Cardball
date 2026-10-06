import { describe, expect, it } from 'vitest';
import { championSeat, formatLabel, recordLabel, scheduleMatches, slotSeat, standingsFrom } from '@cardball/shared';
import type { MatchScore, TournamentMatch, TournamentSeatView } from '@cardball/shared';

const byId = (matches: TournamentMatch[]) => new Map(matches.map((m) => [m.id, m] as const));

describe('tournament schedules', () => {
  it('schedules a round robin where everyone plays everyone once', () => {
    const matches = scheduleMatches('round-robin', 4);
    expect(matches.map((m) => m.id).sort()).toEqual(['rr-0-1', 'rr-0-2', 'rr-0-3', 'rr-1-2', 'rr-1-3', 'rr-2-3']);
    expect(matches.every((m) => 'seed' in m.home && 'seed' in m.away)).toBe(true);
    expect(formatLabel('round-robin')).toBe('Round robin');
  });

  it('gives three managers a bye into the final instead of a third-place game', () => {
    const matches = scheduleMatches('semis', 3);
    expect(matches.map((m) => m.id)).toEqual(['semi-1', 'final']);
    expect(matches[1]!.home).toEqual({ winnerOf: 'semi-1' });
    expect(matches[1]!.away).toEqual({ seed: 0 });
    expect(formatLabel('semis')).toBe('Semifinals, final, and third place');
  });

  it('schedules two semifinals, a third place game, and a final for four', () => {
    const matches = scheduleMatches('semis', 4);
    expect(matches.map((m) => m.id)).toEqual(['semi-1', 'semi-2', 'third', 'final']);
    expect(matches[2]!.home).toEqual({ loserOf: 'semi-1' });
    expect(matches[3]!.home).toEqual({ winnerOf: 'semi-1' });
  });

  it('resolves slots only from decided matches', () => {
    const matches = scheduleMatches('semis', 4);
    const map = byId(matches);
    const undecided = map.get('third')!;
    // Nothing has been played: the third place game has nobody in it.
    expect(slotSeat(undecided.home, map)).toBeNull();
    expect(slotSeat(undecided.away, map)).toBeNull();

    map.get('semi-1')!.winnerSeat = 2;
    map.get('semi-1')!.loserSeat = 0;
    expect(slotSeat(undecided.home, map)).toBe(0);
    expect(slotSeat({ winnerOf: 'semi-1' }, map)).toBe(2);
    // Seeds never need deciding.
    expect(slotSeat({ seed: 1 }, map)).toBe(1);
  });
});

describe('tournament standings', () => {
  const score = (home: number, away: number): MatchScore => ({ home, away, winner: home > away ? 'home' : 'away' });

  /** Seat the seeded slots, the way the service does when it schedules games. */
  const fill = (matches: TournamentMatch[]) => {
    for (const m of matches) {
      m.homeSeat ??= 'seed' in m.home ? m.home.seed : null;
      m.awaySeat ??= 'seed' in m.away ? m.away.seed : null;
    }
    return matches;
  };

  it('counts wins, losses, and runs from decided matches alone', () => {
    const matches = fill(scheduleMatches('round-robin', 3));
    // Seat 0 wins both its games (5–3 each); 1 beats 2 once.
    matches.find((m) => m.id === 'rr-0-1')!.winnerSeat = 0;
    matches.find((m) => m.id === 'rr-0-2')!.winnerSeat = 0;
    matches.find((m) => m.id === 'rr-1-2')!.winnerSeat = 1;
    const table = standingsFrom(3, matches, () => score(5, 3));
    expect(table.map((r) => r.wins)).toEqual([2, 1, 0]);
    expect(table.map((r) => r.losses)).toEqual([0, 1, 2]);
    expect(table.map((r) => r.runsFor)).toEqual([10, 8, 6]);
    expect(table.map((r) => r.runsAgainst)).toEqual([6, 8, 10]);
  });

  it('counts a forfeit as a win and a loss, with no runs', () => {
    const matches = fill(scheduleMatches('round-robin', 3));
    const forfeited = matches.find((m) => m.id === 'rr-1-2')!;
    Object.assign(forfeited, { winnerSeat: 1, loserSeat: 2, forfeit: true, error: 'no starter' });
    const table = standingsFrom(3, matches, () => null);
    expect(table.map((r) => [r.wins, r.losses, r.runsFor])).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });

  it('crowns the final winner in a bracket and the best record in a round robin', () => {
    const robin = fill(scheduleMatches('round-robin', 3));
    robin.find((m) => m.id === 'rr-0-1')!.winnerSeat = 0;
    robin.find((m) => m.id === 'rr-0-2')!.winnerSeat = 0;
    robin.find((m) => m.id === 'rr-1-2')!.winnerSeat = 1;
    expect(championSeat('round-robin', 3, robin, () => score(5, 3))).toBe(0);

    const semis = fill(scheduleMatches('semis', 4));
    semis.find((m) => m.id === 'semi-1')!.winnerSeat = 0;
    semis.find((m) => m.id === 'semi-1')!.loserSeat = 3;
    semis.find((m) => m.id === 'semi-2')!.winnerSeat = 2;
    semis.find((m) => m.id === 'semi-2')!.loserSeat = 1;
    semis.find((m) => m.id === 'third')!.homeSeat = 3;
    semis.find((m) => m.id === 'third')!.awaySeat = 1;
    semis.find((m) => m.id === 'final')!.homeSeat = 0;
    semis.find((m) => m.id === 'final')!.awaySeat = 2;
    semis.find((m) => m.id === 'final')!.winnerSeat = 2;
    expect(championSeat('semis', 4, semis, () => score(5, 3))).toBe(2);
    // An all-error round robin crowns nobody rather than a winless seat.
    const broken = scheduleMatches('round-robin', 3).map((m) => ({ ...m, error: 'roster could not field nine' }));
    expect(championSeat('round-robin', 3, broken, () => score(5, 3))).toBeNull();
  });

  it('breaks round robin ties on run differential, then seat order', () => {
    const matches = fill(scheduleMatches('round-robin', 3));
    // Everyone 1–1.
    matches.find((m) => m.id === 'rr-0-1')!.winnerSeat = 1;
    matches.find((m) => m.id === 'rr-0-2')!.winnerSeat = 0;
    matches.find((m) => m.id === 'rr-1-2')!.winnerSeat = 2;
    const scores: Record<string, MatchScore> = {
      // Seat 1 wins away 4–2, seat 0 wins at home 5–3, seat 2 wins away 5–0.
      'rr-0-1': { home: 2, away: 4, winner: 'away' },
      'rr-0-2': { home: 5, away: 3, winner: 'home' },
      'rr-1-2': { home: 0, away: 5, winner: 'away' },
    };
    expect(championSeat('round-robin', 3, matches, (id) => scores[id] ?? null)).toBe(2);
  });

  it('prints a standings line', () => {
    const seat: TournamentSeatView = {
      userId: 1,
      name: 'Alice',
      seat: 0,
      isHost: true,
      teamId: null,
      teamName: null,
      wins: 2,
      losses: 1,
      runsFor: 12,
      runsAgainst: 6,
    };
    expect(recordLabel(seat)).toBe('2–1, +6');
  });
});

/**
 * The generated historic-collection catalog.
 *
 * The catalog ships as source (`packages/shared/src/historicTeams.ts`), so it
 * is checked here the way a reader would read it: every active franchise has
 * exactly one collection, and each collection is a real lineup and staff.
 */
import { describe, expect, it } from 'vitest';
import { HISTORIC_TEAMS, historicTeamById } from '@cardball/shared';

const FRANCHISES = [
  'Arizona Diamondbacks',
  'Atlanta Braves',
  'Baltimore Orioles',
  'Boston Red Sox',
  'Chicago Cubs',
  'Chicago White Sox',
  'Cincinnati Reds',
  'Cleveland Guardians',
  'Colorado Rockies',
  'Detroit Tigers',
  'Houston Astros',
  'Kansas City Royals',
  'Los Angeles Angels',
  'Los Angeles Dodgers',
  'Miami Marlins',
  'Milwaukee Brewers',
  'Minnesota Twins',
  'New York Mets',
  'New York Yankees',
  'Oakland Athletics',
  'Philadelphia Phillies',
  'Pittsburgh Pirates',
  'San Diego Padres',
  'San Francisco Giants',
  'Seattle Mariners',
  'St. Louis Cardinals',
  'Tampa Bay Rays',
  'Texas Rangers',
  'Toronto Blue Jays',
  'Washington Nationals',
];

const FIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const SLOTS = [...FIELD_POSITIONS, 'DH', 'SP', 'RP'];

describe('the historic collection catalog', () => {
  it('has one collection for each of the 30 active franchises', () => {
    expect(HISTORIC_TEAMS).toHaveLength(30);
    expect([...HISTORIC_TEAMS.map((team) => team.franchise)].sort()).toEqual(FRANCHISES);
  });

  it('gives every collection a stable slug that finds it again', () => {
    const ids = HISTORIC_TEAMS.map((team) => team.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const team of HISTORIC_TEAMS) {
      // the season's Lahman franchise code plus the year, e.g. sea-1995
      expect(team.id).toMatch(/^[a-z0-9]{2,4}-\d{4}$/);
      expect(team.id.endsWith(`-${team.year}`)).toBe(true);
      expect(historicTeamById(team.id)).toBe(team);
      expect(team.year).toBeGreaterThanOrEqual(1901);
      expect(team.year).toBeLessThanOrEqual(2025);
      expect(team.tagline.trim()).not.toBe('');
    }
    expect(historicTeamById('no-such-team-1900')).toBeUndefined();
  });

  it('pre-builds a full lineup and a pitching staff', () => {
    for (const team of HISTORIC_TEAMS) {
      const slots = team.players.map((player) => player.position);
      for (const slot of slots) expect(SLOTS).toContain(slot);
      // One man at each field position, so the collection is a real nine.
      for (const position of FIELD_POSITIONS) {
        expect(slots.filter((slot) => slot === position)).toHaveLength(1);
      }
      expect(slots.filter((slot) => slot === 'SP').length).toBeGreaterThanOrEqual(1);
      expect(slots.filter((slot) => slot === 'RP').length).toBeGreaterThanOrEqual(1);
      expect(team.players.length).toBeGreaterThanOrEqual(10);
      expect(team.players.length).toBeLessThanOrEqual(14);
    }
  });

  it('respects the designated hitter of the day', () => {
    const hasDh = (id: string) => HISTORIC_TEAMS.find((team) => team.id === id)!.players.some((p) => p.position === 'DH');
    // No DH in the books before 1973.
    for (const team of HISTORIC_TEAMS) {
      if (team.year < 1973) expect(team.players.some((player) => player.position === 'DH')).toBe(false);
    }
    // And none in the National League of that era, however modern the pick.
    for (const id of ['atl-1995', 'phi-1980', 'was-2019', 'sdn-1998', 'hou-1998']) expect(hasDh(id)).toBe(false);
    for (const id of ['sea-1995', 'tor-1993', 'oak-1989', 'tex-2011']) expect(hasDh(id)).toBe(true);
  });

  it('names real players, each once per collection', () => {
    for (const team of HISTORIC_TEAMS) {
      const bbrefIds = team.players.map((player) => player.bbrefId);
      expect(new Set(bbrefIds).size).toBe(bbrefIds.length);
      for (const player of team.players) {
        expect(player.bbrefId).toMatch(/^[a-z]+[0-9]{2}$/);
        expect(player.name.trim()).not.toBe('');
        expect(player.name).not.toBe(player.bbrefId); // a name we failed to look up
      }
    }
  });

  it('opens with the two collections the shelf was asked for', () => {
    const seat = historicTeamById('sea-1995');
    expect(seat?.name).toBe('1995 Seattle Mariners');
    expect(seat?.players.find((p) => p.position === 'CF')?.name).toBe('Ken Griffey');
    expect(seat?.players.find((p) => p.position === 'DH')?.name).toBe('Edgar Martinez');
    expect(seat?.players.find((p) => p.position === 'SP')?.name).toBe('Randy Johnson');

    const yanks = historicTeamById('nya-1961');
    expect(yanks?.name).toBe('1961 New York Yankees');
    expect(yanks?.players.find((p) => p.position === 'RF')?.name).toBe('Roger Maris');
    expect(yanks?.players.find((p) => p.position === 'CF')?.name).toBe('Mickey Mantle');
  });
});

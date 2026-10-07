import { describe, expect, it } from 'vitest';
import { buildDataset, summarizeDataset } from '../src/transform.js';

const PEOPLE = `playerID,bbrefID,nameFirst,nameLast,nameGiven,bats,throws,debut,finalGame
batte01,batte01,Ed,Batter,Edward R.,L,R,1951-04-02,1956-09-30
pitch01,pitch01,Pat,Pitcher,,R,L,1994-04-01,1996-09-30
ghost01,ghost01,Gh,Ghost,,,,,`;

const BATTING = `playerID,yearID,stint,teamID,lgID,G,AB,R,H,2B,3B,HR,RBI,SB,CS,BB,SO,IBB,HBP,SH,SF,GIDP
batte01,1951,1,NY1,NL,120,500,60,150,20,5,20,70,10,5,40,50,,,,3,0
batte01,1951,2,BSN,NL,10,40,5,10,2,0,1,5,0,0,3,5,,,,0,0`;

const PITCHING = `playerID,yearID,stint,teamID,G,IPouts,ER,BFP
pitch01,1995,1,ATL,28,600,40,720`;

const FIELDING = `playerID,yearID,stint,teamID,POS,G,InnOuts,PO,A,E,SB,CS
batte01,1951,1,NY1,OF,120,1050,300,10,5,0,0
batte01,1951,2,BSN,OF,10,80,20,1,0,0,0
pitch01,1995,1,ATL,P,28,600,10,25,2,0,0`;

// No 1951 splits exist in the real file either (they start in 1954).
const FIELDING_OF_SPLIT = `playerID,yearID,stint,teamID,POS,G,InnOuts,PO,A,E,SB,CS`;

const FIELDING_OF = `playerID,yearID,Glf,Gcf,Grf
batte01,1951,2,115,3`;

const APPEARANCES = `playerID,yearID,G_all
batte01,1951,110
batte01,1951,15
pitch01,1995,30
ghost01,1954,7`;

function files(): Record<string, string> {
  return {
    'People.csv': PEOPLE,
    'Batting.csv': BATTING,
    'Pitching.csv': PITCHING,
    'Fielding.csv': FIELDING,
    'FieldingOFsplit.csv': FIELDING_OF_SPLIT,
    'FieldingOF.csv': FIELDING_OF,
    'Appearances.csv': APPEARANCES,
  };
}

describe('buildDataset', () => {
  const dataset = buildDataset(files());
  const season = (bbrefId: string, year: number) =>
    dataset.seasons.find((row) => row.bbrefId === bbrefId && row.year === year);
  const person = (bbrefId: string) => dataset.people.find((row) => row.bbrefId === bbrefId);

  it('merges batting stints into one season', () => {
    const row = season('batte01', 1951);
    expect(row).toBeDefined();
    expect(row?.teamLabel).toBe('NY1/BSN');
    expect(row?.ab).toBe(540);
    expect(row?.h).toBe(160);
    expect(row?.avg).toBeCloseTo(160 / 540);
    expect(row?.doubles).toBe(22);
    expect(row?.homeRuns).toBe(21);
    expect(row?.rbi).toBe(75);
    expect(row?.sb).toBe(10);
    expect(row?.pa).toBe(540 + 43 + 0 + 0 + 3);
  });

  it('uses Appearances.csv for games played, summing a mid-season trade', () => {
    // The file has one row per stint (110 + 15), not one row per season.
    expect(season('batte01', 1951)?.games).toBe(125);
    expect(season('pitch01', 1995)?.games).toBe(30);
  });

  it('splits legacy OF rows using the games-by-field file', () => {
    const row = season('batte01', 1951);
    expect(row?.primaryPosition).toBe('CF');
    expect(row?.positionsPlayed).toEqual([{ position: 'CF', games: 130, rating: 0 }]);
  });

  it('merges pitching stints into ERA / IP / batters faced', () => {
    const row = season('pitch01', 1995);
    expect(row?.pitchGames).toBe(28);
    expect(row?.pitchIpOuts).toBe(600);
    expect(row?.pitchBf).toBe(720);
    expect(row?.pitchEra).toBeCloseTo(1.8);
  });

  it('keeps P in positionsPlayed but leaves a pure pitcher without a primary position', () => {
    const row = season('pitch01', 1995);
    expect(row?.positionsPlayed).toEqual([{ position: 'P', games: 28, rating: 0 }]);
    expect(row?.primaryPosition).toBeNull();
  });

  it('creates a season row for anyone who appeared at all', () => {
    const row = season('ghost01', 1954);
    expect(row?.games).toBe(7);
    expect(row?.ab).toBe(0);
    expect(row?.avg).toBeNull();
    expect(row?.positionsPlayed).toEqual([]);
    expect(row?.primaryPosition).toBeNull();
  });

  it('flags starters from a 100-inning season', () => {
    expect(person('pitch01')?.isStarter).toBe(true);
    expect(person('batte01')?.isStarter).toBe(false);
  });

  it('carries the people fields through', () => {
    const batter = person('batte01');
    expect(batter?.nameFirst).toBe('Ed');
    expect(batter?.nameLast).toBe('Batter');
    expect(batter?.nameGiven).toBe('Edward R.');
    expect(batter?.bats).toBe('L');
    expect(batter?.throws).toBe('R');
    expect(batter?.debutYear).toBe(1951);
    expect(batter?.finalYear).toBe(1956);
  });

  it('summarises what it built', () => {
    expect(summarizeDataset(dataset)).toEqual({
      people: 3,
      peopleRows: 3,
      seasons: 3,
      minYear: 1951,
      maxYear: 1995,
      starters: 1,
    });
  });

  it('collapses People.csv rows that share a bbrefID', () => {
    const dupes = files();
    dupes['People.csv'] = `${PEOPLE}
batte02,batte01,Eddie,Batter,,L,R,,`;
    const summary = summarizeDataset(buildDataset(dupes));
    expect(summary.peopleRows).toBe(4);
    expect(summary.people).toBe(3);
  });

  it('fails loudly when the source format changes', () => {
    const broken = files();
    broken['Batting.csv'] = 'playerID,yearID\nbatte01,1951';
    expect(() => buildDataset(broken)).toThrow(/Batting\.csv: missing expected column "stint"/);
  });
});

describe('buildDataset with an active player', () => {
  // The 2025 release leaves `finalGame` (and sometimes `debut`) blank for
  // anyone still playing, which used to leave current players without card
  // years — and so without cards.
  const active = files();
  active['People.csv'] = `${PEOPLE}
active01,active01,Al,Active,,R,R,,`;
  active['Batting.csv'] = `${BATTING}
active01,2019,1,HOU,AL,140,520,80,150,20,3,30,95,5,2,60,100,,,,2,0
active01,2025,1,HOU,AL,150,540,90,160,25,4,35,110,3,1,65,110,,,,1,1`;
  active['Appearances.csv'] = `${APPEARANCES}
active01,2019,140
active01,2025,150`;

  const dataset = buildDataset(active);

  it('backfills the career span from the seasons he played', () => {
    const person = dataset.people.find((row) => row.bbrefId === 'active01');
    expect(person?.debutYear).toBe(2019);
    expect(person?.finalYear).toBe(2025);
  });

  it('keeps a stated final year when it is later than his last season row', () => {
    expect(dataset.people.find((row) => row.bbrefId === 'batte01')?.finalYear).toBe(1956);
  });

  it('still builds both of his seasons', () => {
    expect(dataset.seasons.filter((row) => row.bbrefId === 'active01').map((row) => row.year)).toEqual([2019, 2025]);
  });
});

describe('buildDataset with modern outfield splits', () => {
  // 1954+ Fielding.csv still says "OF"; the LF/CF/RF breakdown only exists in
  // FieldingOFsplit.csv.
  const withSplits = files();
  withSplits['FieldingOFsplit.csv'] = `playerID,yearID,stint,teamID,POS,G,InnOuts,PO,A,E,SB,CS
batte01,1951,1,NY1,CF,118,1040,296,10,5,0,0
batte01,1951,2,BSN,LF,10,80,20,1,0,0,0`;

  it('uses the split file for every outfield position', () => {
    const dataset = buildDataset(withSplits);
    const row = dataset.seasons.find((season) => season.bbrefId === 'batte01' && season.year === 1951);
    expect(row?.positionsPlayed).toEqual([
      { position: 'CF', games: 118, rating: 0 },
      { position: 'LF', games: 10, rating: 0 },
    ]);
    expect(row?.primaryPosition).toBe('CF');
    // 118 + 10 outfield games merged from the split, not the 130-game OF row.
    expect(row?.positionsPlayed.reduce((sum, played) => sum + played.games, 0)).toBe(128);
  });
});

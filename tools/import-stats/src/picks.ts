/**
 * The historic team picks, shared by the two catalogs generated from them:
 * the collection challenges (`challenges.ts`) and the stock bot teams
 * (`stockTeams.ts`).
 *
 * `teamId` is the Lahman franchise code for that season (the Brooklyn Dodgers
 * are BRO, the New York Giants NY1), `dh` says whether that league-year had the
 * designated hitter, and the tagline is what the screen sells it with.
 */
import type { RosterPick } from './rosterBuilder.js';

export interface Pick extends RosterPick {
  franchise: string;
  name: string;
  tagline: string;
}

export const PICKS: readonly Pick[] = [
  // ---- American League East ----
  { franchise: 'Baltimore Orioles', teamId: 'BAL', year: 1970, name: '1970 Baltimore Orioles', tagline: 'Brooks Robinson plays October on a different planet', dh: false },
  { franchise: 'Boston Red Sox', teamId: 'BOS', year: 1967, name: '1967 Boston Red Sox', tagline: 'The Impossible Dream — Yaz carries the card to the pennant', dh: false },
  { franchise: 'New York Yankees', teamId: 'NYA', year: 1961, name: '1961 New York Yankees', tagline: 'The M&M boys chase the Babe, 60 deep', dh: false },
  { franchise: 'Tampa Bay Rays', teamId: 'TBA', year: 2008, name: '2008 Tampa Bay Rays', tagline: '9 = 8, and a worst-to-first pennant', dh: true },
  { franchise: 'Toronto Blue Jays', teamId: 'TOR', year: 1993, name: '1993 Toronto Blue Jays', tagline: 'Back-to-back champions, and Joe Carter still touching ’em all', dh: true },
  // ---- American League Central ----
  { franchise: 'Chicago White Sox', teamId: 'CHA', year: 1959, name: '1959 Chicago White Sox', tagline: 'The Go-Go Sox — hit it on the ground and run', dh: false },
  { franchise: 'Cleveland Guardians', teamId: 'CLE', year: 1954, name: '1954 Cleveland Indians', tagline: '111 wins, and the best rotation money never had to buy', dh: false },
  { franchise: 'Detroit Tigers', teamId: 'DET', year: 1984, name: '1984 Detroit Tigers', tagline: 'Bless You Boys — 35–5 out of the gate', dh: true },
  { franchise: 'Kansas City Royals', teamId: 'KCA', year: 1985, name: '1985 Kansas City Royals', tagline: 'The I-70 Series comes home to Kansas City', dh: true },
  { franchise: 'Minnesota Twins', teamId: 'MIN', year: 1991, name: '1991 Minnesota Twins', tagline: 'Worst to first, and the greatest Game 7 ever pitched', dh: true },
  // ---- American League West ----
  { franchise: 'Houston Astros', teamId: 'HOU', year: 1998, name: '1998 Houston Astros', tagline: 'The Killer B’s, before the Astros ever left the National League', dh: false },
  { franchise: 'Los Angeles Angels', teamId: 'ANA', year: 2002, name: '2002 Anaheim Angels', tagline: 'The Rally Monkey drags a wildcard to the ring', dh: true },
  { franchise: 'Oakland Athletics', teamId: 'OAK', year: 1989, name: '1989 Oakland Athletics', tagline: 'The Bash Brothers sweep the Bay Bridge Series', dh: true },
  { franchise: 'Seattle Mariners', teamId: 'SEA', year: 1995, name: '1995 Seattle Mariners', tagline: 'Refuse to lose — the Kingdome will never be louder', dh: true },
  { franchise: 'Texas Rangers', teamId: 'TEX', year: 2011, name: '2011 Texas Rangers', tagline: 'One strike away, twice — the Rangers’ ride to remember', dh: true },
  // ---- National League East ----
  { franchise: 'Atlanta Braves', teamId: 'ATL', year: 1995, name: '1995 Atlanta Braves', tagline: 'The pitching dynasty finally takes the crown', dh: false },
  { franchise: 'Miami Marlins', teamId: 'FLO', year: 1997, name: '1997 Florida Marlins', tagline: 'A four-year-old franchise wins the whole thing', dh: false },
  { franchise: 'New York Mets', teamId: 'NYN', year: 1969, name: '1969 New York Mets', tagline: 'From the laughingstock to the Miracle Mets', dh: false },
  { franchise: 'Philadelphia Phillies', teamId: 'PHI', year: 1980, name: '1980 Philadelphia Phillies', tagline: 'Schmidt, Lefty, and the franchise’s first ring', dh: false },
  { franchise: 'Washington Nationals', teamId: 'WAS', year: 2019, name: '2019 Washington Nationals', tagline: 'Fight to the finish — the wild card that won it all', dh: false },
  // ---- National League Central ----
  { franchise: 'Chicago Cubs', teamId: 'CHN', year: 1908, name: '1908 Chicago Cubs', tagline: 'Tinker to Evers to Chance — the last Cubs crown for 108 years', dh: false },
  { franchise: 'Cincinnati Reds', teamId: 'CIN', year: 1975, name: '1975 Cincinnati Reds', tagline: 'The Big Red Machine at full throttle', dh: false },
  { franchise: 'Milwaukee Brewers', teamId: 'ML4', year: 1982, name: '1982 Milwaukee Brewers', tagline: 'Harvey’s Wallbangers — six boppers deep', dh: true },
  { franchise: 'Pittsburgh Pirates', teamId: 'PIT', year: 1979, name: '1979 Pittsburgh Pirates', tagline: 'We Are Family — Stargell and the Sisters take October', dh: false },
  { franchise: 'St. Louis Cardinals', teamId: 'SLN', year: 1942, name: '1942 St. Louis Cardinals', tagline: 'Musial arrives; the Redbirds topple the Yankees', dh: false },
  // ---- National League West ----
  { franchise: 'Arizona Diamondbacks', teamId: 'ARI', year: 2001, name: '2001 Arizona Diamondbacks', tagline: 'Randy, Schilling, and a Game 7 winner in the ninth', dh: false },
  { franchise: 'Colorado Rockies', teamId: 'COL', year: 2007, name: '2007 Colorado Rockies', tagline: 'Rocktober — 21 wins in 22 games to the pennant', dh: false },
  { franchise: 'Los Angeles Dodgers', teamId: 'BRO', year: 1955, name: '1955 Brooklyn Dodgers', tagline: 'Next year is finally this year', dh: false },
  { franchise: 'San Diego Padres', teamId: 'SDN', year: 1998, name: '1998 San Diego Padres', tagline: 'Gwynn’s greatest supporting cast wins the West big', dh: false },
  { franchise: 'San Francisco Giants', teamId: 'NY1', year: 1954, name: '1954 New York Giants', tagline: 'The Catch — Willie runs the Polo Grounds forever', dh: false },
];

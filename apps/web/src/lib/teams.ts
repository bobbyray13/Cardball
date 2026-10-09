/**
 * Franchises as cards print them.
 *
 * Card stats carry the record books' team ids (`SLN`, `NYA`, `NY1`), which
 * no fan reads. This table turns them into the abbreviation a card of that
 * era would print (STL, NYY, NYG) and the club's real colors. Old clubs and
 * leagues not listed keep their id and get colors derived from it.
 */

export interface Franchise {
  abbr: string;
  name: string;
  /** dominant uniform color: frames, banners, ink */
  primary: string;
  /** the trim color */
  secondary: string;
}

const F = (abbr: string, name: string, primary: string, secondary: string): Franchise => ({ abbr, name, primary, secondary });

const BY_ID: Record<string, Franchise> = {
  ARI: F('ARI', 'Arizona Diamondbacks', '#A71930', '#30CED8'),
  ATL: F('ATL', 'Atlanta Braves', '#13274F', '#CE1141'),
  BAL: F('BAL', 'Baltimore Orioles', '#DF4601', '#27251F'),
  BOS: F('BOS', 'Boston Red Sox', '#BD3039', '#0C2340'),
  CHN: F('CHC', 'Chicago Cubs', '#0E3386', '#CC3433'),
  CHA: F('CWS', 'Chicago White Sox', '#27251F', '#C4CED4'),
  CIN: F('CIN', 'Cincinnati Reds', '#C6011F', '#27251F'),
  CLE: F('CLE', 'Cleveland', '#00385D', '#E50022'),
  COL: F('COL', 'Colorado Rockies', '#333366', '#C4CED4'),
  DET: F('DET', 'Detroit Tigers', '#0C2340', '#FA4616'),
  HOU: F('HOU', 'Houston Astros', '#002D62', '#EB6E1F'),
  KCA: F('KC', 'Kansas City Royals', '#004687', '#BD9B60'),
  CAL: F('CAL', 'California Angels', '#003263', '#BA0021'),
  ANA: F('ANA', 'Anaheim Angels', '#BA0021', '#003263'),
  LAA: F('LAA', 'Los Angeles Angels', '#BA0021', '#003263'),
  LAN: F('LAD', 'Los Angeles Dodgers', '#005A9C', '#EF3E42'),
  BRO: F('BRO', 'Brooklyn Dodgers', '#005A9C', '#1B2A47'),
  FLO: F('FLA', 'Florida Marlins', '#00A0AF', '#27251F'),
  MIA: F('MIA', 'Miami Marlins', '#00A3E0', '#EF3340'),
  ML4: F('MIL', 'Milwaukee Brewers', '#12284B', '#FFC52F'),
  MIL: F('MIL', 'Milwaukee Brewers', '#12284B', '#FFC52F'),
  SE1: F('SEP', 'Seattle Pilots', '#003087', '#FFB81C'),
  MIN: F('MIN', 'Minnesota Twins', '#002B5C', '#D31145'),
  WS1: F('WSH', 'Washington Senators', '#0C2340', '#C8102E'),
  WS2: F('WSA', 'Washington Senators', '#0C2340', '#C8102E'),
  NYA: F('NYY', 'New York Yankees', '#0C2340', '#C4CED3'),
  NYN: F('NYM', 'New York Mets', '#002D72', '#FF5910'),
  NY1: F('NYG', 'New York Giants', '#27251F', '#FD5A1E'),
  OAK: F('OAK', 'Oakland Athletics', '#003831', '#EFB21E'),
  ATH: F('ATH', 'Athletics', '#003831', '#EFB21E'),
  KC1: F('KCA', 'Kansas City Athletics', '#003831', '#EFB21E'),
  PHA: F('PHA', 'Philadelphia Athletics', '#00205B', '#C8102E'),
  PHI: F('PHI', 'Philadelphia Phillies', '#E81828', '#002D72'),
  PIT: F('PIT', 'Pittsburgh Pirates', '#27251F', '#FDB827'),
  SDN: F('SD', 'San Diego Padres', '#2F241D', '#FFC425'),
  SFN: F('SF', 'San Francisco Giants', '#FD5A1E', '#27251F'),
  SEA: F('SEA', 'Seattle Mariners', '#0C2C56', '#005C5C'),
  SLN: F('STL', 'St. Louis Cardinals', '#C41E3A', '#0C2340'),
  SLA: F('SLB', 'St. Louis Browns', '#4F2C1D', '#F47A20'),
  TBA: F('TB', 'Tampa Bay Rays', '#092C5C', '#8FBCE6'),
  TEX: F('TEX', 'Texas Rangers', '#003278', '#C0111F'),
  TOR: F('TOR', 'Toronto Blue Jays', '#134A8E', '#1D2D5C'),
  WAS: F('WSH', 'Washington Nationals', '#AB0003', '#14225A'),
  MON: F('MON', 'Montreal Expos', '#003087', '#E4002B'),
  BSN: F('BSN', 'Boston Braves', '#13274F', '#CE1141'),
  ML1: F('MLN', 'Milwaukee Braves', '#13274F', '#CE1141'),
};

/** Today's club names (and the Guardians' old one) to the same entries, for labels that use names. */
const BY_NAME: Record<string, Franchise> = Object.fromEntries(
  [
    ...Object.values(BY_ID).map((f) => [f.name.toLowerCase(), f] as const),
    ['cleveland guardians', BY_ID.CLE!] as const,
    ['cleveland indians', BY_ID.CLE!] as const,
    ['tampa bay devil rays', BY_ID.TBA!] as const,
  ],
);

/**
 * The franchise behind a label: a team id, a club name, or a multi-team
 * season (`TOR/SEA`), which is read as the club he finished the year with.
 */
export function franchiseOf(label: string): Franchise | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const last = trimmed.split('/').pop()!.trim();
  return BY_ID[last.toUpperCase()] ?? BY_NAME[trimmed.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgbToHex = (c: RGB): string => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60 : max === gg ? ((bb - rr) / d + 2) * 60 : ((rr - gg) / d + 4) * 60;
  return [h, s, l];
}

/** `a` blended toward `b` by `t` (0 = all a). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export const PAPER = '#f1e7d0';

/** Every color a card front needs, all hex. */
export interface TeamPalette {
  /** the club color, kept dark enough to carry cream lettering */
  primary: string;
  /** a deeper shade of the club color */
  secondary: string;
  /** the club's trim color */
  accent: string;
  /** a light tint of the club color */
  glow: string;
  /** near-black in the club's hue: the frame, the lettering, the silhouette */
  ink: string;
}

function paletteFrom(primaryHex: string, accentHex: string): TeamPalette {
  const [h, s, l] = rgbToHsl(hexToRgb(primaryHex));
  // A very dark club color (Yankees navy, White Sox black) is fine as is; a
  // bright one (Giants orange, Marlins blue) is deepened so cream reads on it.
  const primary = rgbToHex(hslToRgb(h, Math.min(s, 0.85), Math.min(l, 0.42)));
  return {
    primary,
    secondary: mix(primary, '#000000', 0.3),
    accent: accentHex,
    glow: rgbToHex(hslToRgb(h, Math.min(0.6, s), 0.74)),
    ink: rgbToHex(hslToRgb(h, Math.min(0.45, s), Math.min(0.13, l))),
  };
}

/** The club's palette when we know the club; otherwise one derived from the label, stable per label. */
export function teamPalette(label: string): TeamPalette {
  const known = franchiseOf(label);
  if (known) return paletteFrom(known.primary, known.secondary);
  let hue = 0;
  const key = label || 'Cardball';
  for (let i = 0; i < key.length; i++) hue = (hue * 31 + key.charCodeAt(i)) % 360;
  return paletteFrom(rgbToHex(hslToRgb(hue, 0.52, 0.3)), rgbToHex(hslToRgb((hue + 190) % 360, 0.6, 0.62)));
}

/** The abbreviation a card prints: `SLN` → `STL`, `TOR/SEA` → `TOR/SEA`, unknown ids as-is. */
export function teamAbbr(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '';
  const named = BY_NAME[trimmed.toLowerCase()];
  if (named) return named.abbr;
  return trimmed
    .split('/')
    .map((id) => BY_ID[id.trim().toUpperCase()]?.abbr ?? id.trim())
    .join('/');
}

/**
 * Finding the card in a photo of it.
 *
 * Phone photos come in with a table or a lap around the card, so the shelf
 * would show every card differently framed. Before upload we find the card's
 * outline and warp it to fill the frame, perspective and all.
 *
 * The outline is found the way a document scanner finds a page: straight
 * edges are pulled out of the photo with a Hough transform, every pair of
 * roughly parallel edges crossed with another pair is a candidate rectangle,
 * and each candidate is scored by how much of its perimeter really runs along
 * an edge in the photo, how big it is, and how card-shaped it is. The winner's
 * sides are then re-fitted against the full-resolution photo so the crop lands
 * on the card's edge rather than a few pixels either side of it.
 *
 * The card keeps the orientation it was photographed in: a horizontal card
 * comes out landscape, a vertical one portrait. Everything here is pure math
 * over pixel buffers, so it runs in the browser and is easy to test.
 */

export interface Point {
  x: number;
  y: number;
}

/** Card corners in winding order: top-left, top-right, bottom-right, bottom-left. */
export interface Quad {
  corners: [Point, Point, Point, Point];
}

/** The pixel buffers this module works on — an ImageData shape, no DOM needed. */
export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Detection failed — the photo is kept as the user shot it. */
export type DetectResult = { quad: Quad; coverage: number } | null;

const WORK_MAX_EDGE = 320;
/** A standard card is 2.5 by 3.5 inches. */
const CARD_ASPECT = 2.5 / 3.5;
const DEG = Math.PI / 180;

const luma = (data: PixelImage['data'], at: number): number =>
  0.299 * (data[at] ?? 0) + 0.587 * (data[at + 1] ?? 0) + 0.114 * (data[at + 2] ?? 0);

// ---------------------------------------------------------------------------
// Working image: small, grey, smoothed, with gradients
// ---------------------------------------------------------------------------

interface Work {
  width: number;
  height: number;
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
  /** source pixels per working pixel, per axis */
  sx: number;
  sy: number;
}

/** Area-average downscale to luminance: averaging, not point sampling, keeps table grain from turning into edges. */
function downscaleGray(img: PixelImage, maxEdge: number): { width: number; height: number; gray: Float32Array } {
  const s = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * s));
  const height = Math.max(1, Math.round(img.height * s));
  const sum = new Float32Array(width * height);
  const count = new Uint32Array(width * height);
  for (let y = 0; y < img.height; y++) {
    const oy = Math.min(height - 1, Math.floor((y * height) / img.height));
    for (let x = 0; x < img.width; x++) {
      const ox = Math.min(width - 1, Math.floor((x * width) / img.width));
      const at = oy * width + ox;
      sum[at] = sum[at]! + luma(img.data, (y * img.width + x) * 4);
      count[at] = count[at]! + 1;
    }
  }
  for (let i = 0; i < sum.length; i++) sum[i] = sum[i]! / Math.max(1, count[i]!);
  return { width, height, gray: sum };
}

/** Separable 5-tap binomial blur, clamped at the borders. */
function blur(gray: Float32Array, width: number, height: number): Float32Array {
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(gray.length);
  const out = new Float32Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -2; i <= 2; i++) acc += k[i + 2]! * gray[y * width + Math.min(width - 1, Math.max(0, x + i))]!;
      tmp[y * width + x] = acc / 16;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = -2; i <= 2; i++) acc += k[i + 2]! * tmp[Math.min(height - 1, Math.max(0, y + i)) * width + x]!;
      out[y * width + x] = acc / 16;
    }
  }
  return out;
}

function workImage(img: PixelImage): Work {
  const small = downscaleGray(img, WORK_MAX_EDGE);
  const { width, height } = small;
  const g = blur(small.gray, width, height);
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = y * width + x;
      const dx =
        -g[at - width - 1]! + g[at - width + 1]! - 2 * g[at - 1]! + 2 * g[at + 1]! - g[at + width - 1]! + g[at + width + 1]!;
      const dy =
        -g[at - width - 1]! - 2 * g[at - width]! - g[at - width + 1]! + g[at + width - 1]! + 2 * g[at + width]! + g[at + width + 1]!;
      gx[at] = dx;
      gy[at] = dy;
      mag[at] = Math.hypot(dx, dy);
    }
  }
  return { width, height, gx, gy, mag, sx: img.width / width, sy: img.height / height };
}

/** The magnitude below which `share` of the image's gradients fall. */
function percentile(mag: Float32Array, share: number): number {
  let max = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i]! > max) max = mag[i]!;
  if (max === 0) return 0;
  const bins = 512;
  const hist = new Uint32Array(bins);
  for (let i = 0; i < mag.length; i++) hist[Math.min(bins - 1, Math.floor((mag[i]! / max) * bins))]!++;
  const target = share * mag.length;
  let seen = 0;
  for (let b = 0; b < bins; b++) {
    seen += hist[b]!;
    if (seen >= target) return ((b + 1) / bins) * max;
  }
  return max;
}

/** Thin edge pixels: strong gradients that are the local peak across the edge. */
function edgePixels(work: Work, threshold: number): number[] {
  const { width, height, gx, gy, mag } = work;
  const out: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = y * width + x;
      const m = mag[at]!;
      if (m < threshold) continue;
      const dx = Math.round(gx[at]! / m);
      const dy = Math.round(gy[at]! / m);
      const step = dy * width + dx;
      if (m >= mag[at + step]! && m >= mag[at - step]!) out.push(at);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Straight edges
// ---------------------------------------------------------------------------

/** A line `x·cos θ + y·sin θ = ρ`, θ in [0, π). */
interface Line {
  theta: number;
  rho: number;
  votes: number;
}

const THETA_BINS = 180;

function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

/** Two lines that are the same line, allowing for θ wrapping round with ρ flipped. */
function sameLine(a: Line, b: Line, rhoTol: number): boolean {
  if (angleBetween(a.theta, b.theta) > 3 * DEG) return false;
  const flipped = Math.abs(a.theta - b.theta) > Math.PI / 2;
  return Math.abs(a.rho - (flipped ? -b.rho : b.rho)) <= rhoTol;
}

function houghLines(work: Work, edges: number[], minVotes: number, maxLines: number): Line[] {
  const { width, height, gx, gy, mag } = work;
  const diag = Math.ceil(Math.hypot(width, height));
  const rhos = 2 * diag + 1;
  const acc = new Float32Array(THETA_BINS * rhos);
  const cos = new Float64Array(THETA_BINS);
  const sin = new Float64Array(THETA_BINS);
  for (let t = 0; t < THETA_BINS; t++) {
    cos[t] = Math.cos((t * Math.PI) / THETA_BINS);
    sin[t] = Math.sin((t * Math.PI) / THETA_BINS);
  }
  // Each edge pixel only votes for lines near its own gradient direction: the
  // gradient is the line's normal, which keeps the accumulator clean.
  const spread = 8;
  for (const at of edges) {
    const x = at % width;
    const y = (at - x) / width;
    let phi = Math.atan2(gy[at]!, gx[at]!);
    if (phi < 0) phi += Math.PI;
    const tb = Math.round((phi / Math.PI) * THETA_BINS) % THETA_BINS;
    const m = mag[at]!;
    for (let d = -spread; d <= spread; d++) {
      const t = (tb + d + THETA_BINS) % THETA_BINS;
      const r = Math.round(x * cos[t]! + y * sin[t]!) + diag;
      acc[t * rhos + r] = acc[t * rhos + r]! + m;
    }
  }

  const peaks: Line[] = [];
  const wT = 3;
  const wR = 4;
  for (let t = 0; t < THETA_BINS; t++) {
    for (let r = 0; r < rhos; r++) {
      const v = acc[t * rhos + r]!;
      if (v < minVotes) continue;
      let isPeak = true;
      for (let dt = -wT; dt <= wT && isPeak; dt++) {
        const tt = t + dt;
        if (tt < 0 || tt >= THETA_BINS) continue;
        for (let dr = -wR; dr <= wR; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= rhos || (dt === 0 && dr === 0)) continue;
          const o = acc[tt * rhos + rr]!;
          // Ties broken by position so a flat-topped peak yields one line.
          if (o > v || (o === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) peaks.push({ theta: (t * Math.PI) / THETA_BINS, rho: r - diag, votes: v });
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  const kept: Line[] = [];
  for (const p of peaks) {
    if (kept.length >= maxLines) break;
    if (!kept.some((k) => sameLine(k, p, 6))) kept.push(p);
  }
  return kept;
}

function intersect(a: Line, b: Line): Point | null {
  const ca = Math.cos(a.theta);
  const sa = Math.sin(a.theta);
  const cb = Math.cos(b.theta);
  const sb = Math.sin(b.theta);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.rho * sb - b.rho * sa) / det, y: (ca * b.rho - cb * a.rho) / det };
}

// ---------------------------------------------------------------------------
// Quads
// ---------------------------------------------------------------------------

function quadArea(corners: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/**
 * Put corners in the winding the warp expects: clockwise on screen, starting
 * at the corner whose next edge points most nearly to the right — the top-left
 * of a card photographed anywhere short of 45° off square.
 */
function orderCorners(corners: Point[]): Quad['corners'] {
  const cw = quadArea(corners) >= 0 ? corners : [...corners].reverse();
  let start = 0;
  let best = -Infinity;
  for (let i = 0; i < 4; i++) {
    const a = cw[i]!;
    const b = cw[(i + 1) % 4]!;
    const rightward = (b.x - a.x) / Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y));
    if (rightward > best) {
      best = rightward;
      start = i;
    }
  }
  return [0, 1, 2, 3].map((i) => cw[(start + i) % 4]!) as Quad['corners'];
}

/** Convex, inside the frame (give or take), a sane size, with corners near square. */
function plausible(corners: readonly Point[], width: number, height: number): boolean {
  const margin = 0.03 * Math.max(width, height);
  if (corners.some((p) => p.x < -margin || p.y < -margin || p.x > width + margin || p.y > height + margin)) return false;
  const area = Math.abs(quadArea(corners));
  const frame = width * height;
  if (area < frame * 0.08 || area > frame * 0.985) return false;
  const minSide = Math.min(width, height) * 0.12;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const c = corners[(i + 2) % 4]!;
    const e1x = b.x - a.x;
    const e1y = b.y - a.y;
    const e2x = c.x - b.x;
    const e2y = c.y - b.y;
    const l1 = Math.hypot(e1x, e1y);
    const l2 = Math.hypot(e2x, e2y);
    if (l1 < minSide) return false;
    const cross = e1x * e2y - e1y * e2x;
    const s = Math.sign(cross);
    if (s === 0) return false;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
    // Interior angle within 50°–130°: a photographed rectangle, not a sliver.
    const cosAngle = -(e1x * e2x + e1y * e2y) / (l1 * l2);
    if (Math.abs(cosAngle) > Math.cos(50 * DEG)) return false;
  }
  return true;
}

/**
 * Share of a side that runs along a real edge: at each step along it, the
 * strongest gradient across the side within a pixel or two, against `strong`.
 */
function sideSupport(work: Work, a: Point, b: Point, strong: number): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const tx = (b.x - a.x) / len;
  const ty = (b.y - a.y) / len;
  const nx = -ty;
  const ny = tx;
  const steps = Math.max(8, Math.round(len));
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) / steps;
    const px = a.x + (b.x - a.x) * s;
    const py = a.y + (b.y - a.y) * s;
    let best = 0;
    for (let off = -2; off <= 2; off++) {
      const x = Math.round(px + nx * off);
      const y = Math.round(py + ny * off);
      if (x < 1 || y < 1 || x >= work.width - 1 || y >= work.height - 1) continue;
      const at = y * work.width + x;
      const across = Math.abs(work.gx[at]! * nx + work.gy[at]! * ny);
      if (across > best) best = across;
    }
    total += Math.min(1, best / strong);
  }
  return total / steps;
}

function aspectOf(corners: readonly Point[]): number {
  const { width, height } = quadSize(corners as Quad['corners']);
  return Math.min(width, height) / Math.max(1e-9, Math.max(width, height));
}

/** How card-shaped a quad is: 1 for a standard card, falling off gently either side. */
function aspectFit(corners: readonly Point[]): number {
  const off = Math.log(aspectOf(corners) / CARD_ASPECT);
  return Math.max(0.35, Math.exp(-(off * off) / (2 * 0.22 * 0.22)));
}

interface Candidate {
  corners: Quad['corners'];
  score: number;
}

function bestQuad(work: Work, lines: Line[], strong: number): Candidate | null {
  const { width, height } = work;
  const minDim = Math.min(width, height);
  const frame = width * height;

  const pairs: [Line, Line][] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!;
      const b = lines[j]!;
      if (angleBetween(a.theta, b.theta) > 20 * DEG) continue;
      const flipped = Math.abs(a.theta - b.theta) > Math.PI / 2;
      if (Math.abs(a.rho - (flipped ? -b.rho : b.rho)) < minDim * 0.12) continue;
      pairs.push([a, b]);
    }
  }

  let best: Candidate | null = null;
  for (let p = 0; p < pairs.length; p++) {
    for (let q = p + 1; q < pairs.length; q++) {
      const [a1, a2] = pairs[p]!;
      const [b1, b2] = pairs[q]!;
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue;
      if (angleBetween(a1.theta, b1.theta) < 55 * DEG) continue;
      const raw = [intersect(a1, b1), intersect(a1, b2), intersect(a2, b2), intersect(a2, b1)];
      if (raw.some((c) => c === null)) continue;
      const corners = raw as Point[];
      if (!plausible(corners, width, height)) continue;

      let weighted = 0;
      let perimeter = 0;
      let weakest = 1;
      for (let i = 0; i < 4; i++) {
        const a = corners[i]!;
        const b = corners[(i + 1) % 4]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const support = sideSupport(work, a, b, strong);
        weighted += support * len;
        perimeter += len;
        weakest = Math.min(weakest, support);
      }
      // Every side has to be really there; a card is a closed outline.
      if (weakest < 0.3) continue;
      const support = weighted / perimeter;
      const areaShare = Math.abs(quadArea(corners)) / frame;
      // Bigger wins among well-supported outlines, so the card's outer edge
      // beats the printed frame around its photo.
      const score = support * support * Math.sqrt(areaShare) * aspectFit(corners) * (0.75 + 0.25 * weakest);
      if (!best || score > best.score) best = { corners: orderCorners(corners), score };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Full-resolution refinement
// ---------------------------------------------------------------------------

interface FitLine {
  px: number;
  py: number;
  dx: number;
  dy: number;
}

function lumaAt(img: PixelImage, x: number, y: number): number {
  const cx = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  return luma(img.data, (cy * img.width + cx) * 4);
}

/** Total-least-squares line through points, dropping outliers once. */
function fitLine(points: Point[]): FitLine | null {
  const fit = (pts: Point[]): FitLine | null => {
    if (pts.length < 2) return null;
    let mx = 0;
    let my = 0;
    for (const p of pts) {
      mx += p.x;
      my += p.y;
    }
    mx /= pts.length;
    my /= pts.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2;
      syy += (p.y - my) ** 2;
      sxy += (p.x - mx) * (p.y - my);
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) };
  };
  const first = fit(points);
  if (!first) return null;
  const residual = (p: Point, l: FitLine) => Math.abs((p.x - l.px) * -l.dy + (p.y - l.py) * l.dx);
  const sorted = points.map((p) => residual(p, first)).sort((a, b) => a - b);
  const cutoff = Math.max(1.5, 2.5 * sorted[Math.floor(sorted.length / 2)]!);
  return fit(points.filter((p) => residual(p, first) <= cutoff));
}

/** Re-find one side of the card in the full photo, near where the small image put it. */
function refineSide(img: PixelImage, a: Point, b: Point, search: number): FitLine | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const tx = (b.x - a.x) / len;
  const ty = (b.y - a.y) / len;
  const nx = -ty;
  const ny = tx;
  const samples = 60;
  const found: Point[] = [];
  const across = (x: number, y: number) =>
    // Averaged a little along the side so print detail and noise wash out.
    lumaAt(img, x - tx * 1.5, y - ty * 1.5) + lumaAt(img, x, y) + lumaAt(img, x + tx * 1.5, y + ty * 1.5);
  for (let i = 0; i < samples; i++) {
    // Stay clear of the corners, where the neighbouring side interferes.
    const s = 0.08 + (0.84 * i) / (samples - 1);
    const bx = a.x + (b.x - a.x) * s;
    const by = a.y + (b.y - a.y) * s;
    let best = 0;
    let bestOff = 0;
    for (let off = -search; off <= search; off++) {
      const x = bx + nx * off;
      const y = by + ny * off;
      const g = Math.abs(across(x + nx, y + ny) - across(x - nx, y - ny)) / 3;
      if (g > best) {
        best = g;
        bestOff = off;
      }
    }
    if (best >= 10) found.push({ x: bx + nx * bestOff, y: by + ny * bestOff });
  }
  if (found.length < samples * 0.4) return null;
  return fitLine(found);
}

function crossFit(a: FitLine, b: FitLine): Point | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return { x: a.px + a.dx * t, y: a.py + a.dy * t };
}

function refineQuad(img: PixelImage, corners: Quad['corners'], scale: number): Quad['corners'] {
  const search = Math.ceil(2.5 * scale) + 2;
  const sides = [0, 1, 2, 3].map((i) => refineSide(img, corners[i]!, corners[(i + 1) % 4]!, search));
  return corners.map((c, i) => {
    // Corner i sits between side i-1 (coming in) and side i (going out).
    const into = sides[(i + 3) % 4];
    const out = sides[i];
    if (!into || !out) return c;
    const p = crossFit(into, out);
    if (!p || Math.hypot(p.x - c.x, p.y - c.y) > search * 2) return c;
    return p;
  }) as Quad['corners'];
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Find the card in a photo, or say there is none. The quad comes back in the
 * same coordinates as the input image (detection runs on a downscaled copy).
 */
export function detectCardQuad(img: PixelImage): DetectResult {
  if (img.width < 16 || img.height < 16) return null;
  const work = workImage(img);
  const threshold = Math.max(8, percentile(work.mag, 0.85));
  const edges = edgePixels(work, threshold);
  if (edges.length === 0) return null;
  const minDim = Math.min(work.width, work.height);
  const lines = houghLines(work, edges, threshold * minDim * 0.12, 36);
  if (lines.length < 4) return null;
  const strong = Math.max(16, threshold * 2);
  const found = bestQuad(work, lines, strong);
  if (!found) return null;

  const scaled = found.corners.map((p) => ({ x: p.x * work.sx, y: p.y * work.sy })) as Quad['corners'];
  const corners = refineQuad(img, scaled, Math.max(work.sx, work.sy));
  return { quad: { corners }, coverage: Math.abs(quadArea(corners)) / (img.width * img.height) };
}

// ---------------------------------------------------------------------------
// Perspective warp
// ---------------------------------------------------------------------------

/** Solve the 8x8 linear system for a homography from the unit square to the quad. */
export function homography(quad: Quad['corners']): number[] {
  // (u, v) on the unit square maps to the quad; h33 is fixed at 1.
  const unit: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = unit[i]!;
    const [x, y] = [quad[i]!.x, quad[i]!.y];
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  // Gaussian elimination with partial pivoting; the systems here are tiny.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const rowPivot = a[col]!;
    const d = rowPivot[col]!;
    if (Math.abs(d) < 1e-9) throw new Error('degenerate quad');
    for (let j = col; j < 8; j++) rowPivot[j] = rowPivot[j]! / d;
    b[col] = b[col]! / d;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = a[row]![col]!;
      if (factor === 0) continue;
      const target = a[row]!;
      for (let j = col; j < 8; j++) target[j] = target[j]! - factor * rowPivot[j]!;
      b[row] = b[row]! - factor * b[col]!;
    }
  }
  return [...b, 1];
}

/** Apply the homography to a point on the unit square. */
function mapPoint(h: number[], u: number, v: number): Point {
  const w = h[6]! * u + h[7]! * v + 1;
  return { x: (h[0]! * u + h[1]! * v + h[2]!) / w, y: (h[3]! * u + h[4]! * v + h[5]!) / w };
}

const sample = (img: PixelImage, x: number, y: number, out: Uint8ClampedArray, at: number): void => {
  const cx = Math.min(img.width - 1, Math.max(0, x));
  const cy = Math.min(img.height - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const idx = (x: number, y: number) => (y * img.width + x) * 4;
  for (let ch = 0; ch < 4; ch++) {
    const top = (img.data[idx(x0, y0) + ch] ?? 0) * (1 - fx) + (img.data[idx(x1, y0) + ch] ?? 0) * fx;
    const bottom = (img.data[idx(x0, y1) + ch] ?? 0) * (1 - fx) + (img.data[idx(x1, y1) + ch] ?? 0) * fx;
    out[at + ch] = top * (1 - fy) + bottom * fy;
  }
};

/** The card's own width and height, taken from the quad's edges. */
export function quadSize(quad: Quad['corners']): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  const width = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const height = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  return { width, height };
}

export interface Warped {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A sliver trimmed off each edge, so the crop never shows a hairline of table. */
const EDGE_TRIM = 0.004;

/**
 * Warp the quad to fill the frame. The output keeps the card's own aspect and
 * the orientation it was photographed in: a horizontal card stays horizontal.
 */
export function warpQuad(img: PixelImage, quad: Quad): Warped {
  const h = homography(quad.corners);
  const size = quadSize(quad.corners);
  const limit = Math.max(img.width, img.height);
  const outWidth = Math.max(24, Math.min(limit, Math.round(size.width)));
  const outHeight = Math.max(24, Math.min(limit, Math.round(size.height)));
  const span = 1 - 2 * EDGE_TRIM;

  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    const v = EDGE_TRIM + (span * (y + 0.5)) / outHeight;
    for (let x = 0; x < outWidth; x++) {
      const u = EDGE_TRIM + (span * (x + 0.5)) / outWidth;
      const p = mapPoint(h, u, v);
      sample(img, p.x - 0.5, p.y - 0.5, data, (y * outWidth + x) * 4);
    }
  }
  return { width: outWidth, height: outHeight, data };
}

/** Turn an image by quarter turns: positive is clockwise. */
export function rotateQuarterTurns(img: Warped, turns: number): Warped {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return img;
  const { width: w, height: h } = img;
  const outWidth = t === 2 ? w : h;
  const outHeight = t === 2 ? h : w;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      let sx: number;
      let sy: number;
      if (t === 1) {
        sx = y;
        sy = h - 1 - x;
      } else if (t === 2) {
        sx = w - 1 - x;
        sy = h - 1 - y;
      } else {
        sx = w - 1 - y;
        sy = x;
      }
      const from = (sy * w + sx) * 4;
      const to = (y * outWidth + x) * 4;
      data[to] = img.data[from]!;
      data[to + 1] = img.data[from + 1]!;
      data[to + 2] = img.data[from + 2]!;
      data[to + 3] = img.data[from + 3]!;
    }
  }
  return { width: outWidth, height: outHeight, data };
}

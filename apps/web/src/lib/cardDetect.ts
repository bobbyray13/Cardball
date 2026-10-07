/**
 * Finding the card in a photo of it.
 *
 * Phone photos come in with a table or a lap around the card, so the shelf
 * would show every card differently framed. Before upload we find the card's
 * outline — a strong closed edge on a quiet background — and warp it to fill
 * the frame, perspective and all. Everything here is pure math over pixel
 * buffers, so it runs in the browser and is easy to test.
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

const WORK_WIDTH = 224;

/** Luminance, downscaled to working size. */
function toGray(img: PixelImage, outWidth: number): { width: number; height: number; gray: Float32Array } {
  const outHeight = Math.max(1, Math.round((img.height * outWidth) / img.width));
  const gray = new Float32Array(outWidth * outHeight);
  const sx = img.width / outWidth;
  const sy = img.height / outHeight;
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      // Nearest-neighbour is plenty at detection resolution.
      const px = Math.min(img.width - 1, Math.round(x * sx));
      const py = Math.min(img.height - 1, Math.round(y * sy));
      const at = (py * img.width + px) * 4;
      gray[y * outWidth + x] =
        0.299 * (img.data[at] ?? 0) + 0.587 * (img.data[at + 1] ?? 0) + 0.114 * (img.data[at + 2] ?? 0);
    }
  }
  return { width: outWidth, height: outHeight, gray };
}

/** Sobel edge magnitude, then a binary edge map at a threshold off the gradient's own spread. */
function edgeMap(gray: { width: number; height: number; gray: Float32Array }): { mag: Float32Array; edge: Uint8Array; mean: number } {
  const { width, height, gray: g } = gray;
  const mag = new Float32Array(width * height);
  let sum = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = y * width + x;
      const gx =
        -g[at - width - 1]! + g[at - width + 1]! - 2 * g[at - 1]! + 2 * g[at + 1]! - g[at + width - 1]! + g[at + width + 1]!;
      const gy =
        -g[at - width - 1]! - 2 * g[at - width]! - g[at - width + 1]! + g[at + width - 1]! + 2 * g[at + width]! + g[at + width + 1]!;
      const m = Math.hypot(gx, gy);
      mag[at] = m;
      sum += m;
    }
  }
  const mean = sum / Math.max(1, (width - 2) * (height - 2));
  // Spread of the gradient decides what counts as an edge: a photo with a
  // crisp card on a plain table has few strong edges, a busy one has many.
  let variance = 0;
  for (let i = 0; i < mag.length; i++) variance += (mag[i]! - mean) ** 2;
  const std = Math.sqrt(variance / Math.max(1, mag.length));
  const threshold = Math.max(20, Math.min(140, mean + 1.7 * std));

  const edge = new Uint8Array(width * height);
  for (let i = 0; i < mag.length; i++) edge[i] = mag[i]! >= threshold ? 1 : 0;
  return { mag, edge, mean };
}

/** Mark the background: everything a flood fill reaches from the frame border without crossing an edge. */
function background(edge: Uint8Array, width: number, height: number): Uint8Array {
  const bg = new Uint8Array(width * height);
  const queue: number[] = [];
  const seed = (x: number, y: number) => {
    const at = y * width + x;
    if (!bg[at] && !edge[at]) {
      bg[at] = 1;
      queue.push(at);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }
  while (queue.length > 0) {
    const at = queue.pop()!;
    const x = at % width;
    const y = (at - x) / width;
    // Four-connected walk around the card's edge.
    if (x > 0 && !bg[at - 1] && !edge[at - 1]) {
      bg[at - 1] = 1;
      queue.push(at - 1);
    }
    if (x < width - 1 && !bg[at + 1] && !edge[at + 1]) {
      bg[at + 1] = 1;
      queue.push(at + 1);
    }
    if (y > 0 && !bg[at - width] && !edge[at - width]) {
      bg[at - width] = 1;
      queue.push(at - width);
    }
    if (y < height - 1 && !bg[at + width] && !edge[at + width]) {
      bg[at + width] = 1;
      queue.push(at + width);
    }
  }
  return bg;
}

/** The card: the largest clump of pixels the background flood could not reach. */
function cardBlob(bg: Uint8Array, width: number, height: number): Set<number> | null {
  const seen = new Uint8Array(width * height);
  let best: Set<number> | null = null;
  for (let start = 0; start < width * height; start++) {
    if (bg[start] || seen[start]) continue;
    const blob = new Set<number>();
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const at = queue.pop()!;
      blob.add(at);
      const x = at % width;
      const y = (at - x) / width;
      const visit = (next: number) => {
        if (!bg[next] && !seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      };
      if (x > 0) visit(at - 1);
      if (x < width - 1) visit(at + 1);
      if (y > 0) visit(at - width);
      if (y < height - 1) visit(at + width);
    }
    if (best === null || blob.size > best.size) best = blob;
  }
  return best;
}

/**
 * The blob's corners: the extremes of x+y and x−y are the corners of a rotated
 * rectangle, and near enough for a photographed card.
 */
function quadOfBlob(blob: Set<number>, width: number, height: number): Quad | null {
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  const extremes = { tl: null, br: null, tr: null, bl: null } as Record<string, number | null>;
  for (const at of blob) {
    const x = at % width;
    const y = (at - x) / width;
    const sum = x + y;
    const diff = x - y;
    if (sum < minSum) {
      minSum = sum;
      extremes.tl = at;
    }
    if (sum > maxSum) {
      maxSum = sum;
      extremes.br = at;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      extremes.tr = at;
    }
    if (diff < minDiff) {
      minDiff = diff;
      extremes.bl = at;
    }
  }
  if (Object.values(extremes).some((v) => v === null)) return null;
  const point = (at: number) => {
    const x = at % width;
    return { x, y: (at - x) / width };
  };
  return {
    corners: [point(extremes.tl!), point(extremes.tr!), point(extremes.br!), point(extremes.bl!)],
  };
}

function quadArea(quad: Quad): number {
  const [tl, tr, br, bl] = quad.corners;
  const shoelace = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(shoelace(tl, tr, br) + shoelace(br, bl, tl)) / 2;
}

/** A quad is usable when it is convex, reasonably big, and not the whole frame. */
function quadIsPlausible(quad: Quad, width: number, height: number): boolean {
  const area = quadArea(quad);
  const frame = width * height;
  if (area < frame * 0.12 || area > frame * 1.05) return false;
  const [tl, tr, br, bl] = quad.corners;
  const edges: [number, number][] = [
    [tr.x - tl.x, tr.y - tl.y],
    [br.x - tr.x, br.y - tr.y],
    [bl.x - br.x, bl.y - br.y],
    [tl.x - bl.x, tl.y - bl.y],
  ];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = edges[i]!;
    const [bx, by] = edges[(i + 1) % 4]!;
    const cross = ax * by - ay * bx;
    if (Math.abs(cross) < 1e-6) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false; // concave somewhere
  }
  // Every side a sane share of the frame: rejects hairline slivers.
  const minSide = Math.min(width, height) * 0.2;
  const lengths = [
    Math.hypot(tr.x - tl.x, tr.y - tl.y),
    Math.hypot(br.x - tr.x, br.y - tr.y),
    Math.hypot(bl.x - br.x, bl.y - br.y),
    Math.hypot(tl.x - bl.x, tl.y - bl.y),
  ];
  return lengths.every((len) => len >= minSide);
}

/**
 * Find the card in a photo, or say there is none. The quad comes back in the
 * same coordinates as the input image (detection runs on a downscaled copy).
 */
export function detectCardQuad(img: PixelImage): DetectResult {
  const workWidth = Math.min(WORK_WIDTH, img.width);
  const gray = toGray(img, workWidth);
  const { edge } = edgeMap(gray);
  const bg = background(edge, gray.width, gray.height);
  const blob = cardBlob(bg, gray.width, gray.height);
  if (blob === null || blob.size < gray.width * gray.height * 0.08) return null;

  const quad = quadOfBlob(blob, gray.width, gray.height);
  if (quad === null) return null;
  if (!quadIsPlausible(quad, gray.width, gray.height)) return null;

  // Back to input-image coordinates.
  const scale = img.width / gray.width;
  const corners = quad.corners.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Quad['corners'];
  return { quad: { corners }, coverage: blob.size / (gray.width * gray.height) };
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

/**
 * Warp the quad to fill the frame. The output keeps the card's own aspect and
 * is always portrait — cards are taller than they are wide, and a photo taken
 * sideways is rotated back upright.
 */
export function warpQuad(img: PixelImage, quad: Quad): Warped {
  const h = homography(quad.corners);
  let { width, height } = quadSize(quad.corners);
  width = Math.max(24, Math.min(img.width, Math.round(width)));
  height = Math.max(24, Math.min(img.height, Math.round(height)));
  const portrait = width <= height;
  const outWidth = portrait ? width : height;
  const outHeight = portrait ? height : width;

  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      let u: number;
      let v: number;
      if (portrait) {
        u = (x + 0.5) / outWidth;
        v = (y + 0.5) / outHeight;
      } else {
        // Landscape card: rotate a quarter turn to stand it upright.
        u = 1 - (y + 0.5) / outHeight;
        v = (x + 0.5) / outWidth;
      }
      const p = mapPoint(h, u, v);
      sample(img, p.x - 0.5, p.y - 0.5, data, (y * outWidth + x) * 4);
    }
  }
  return { width: outWidth, height: outHeight, data };
}

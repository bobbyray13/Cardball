/**
 * Finding and straightening the card in a photo.
 *
 * These run on synthetic pixel buffers — a bright card on a dark table, worked
 * out with plain arithmetic — so the whole photo path can be tested without a
 * browser or a real camera roll.
 */
import { describe, expect, it } from 'vitest';
import { detectCardQuad, homography, quadSize, warpQuad } from '../src/lib/cardDetect.js';
import type { PixelImage, Point, Quad } from '../src/lib/cardDetect.js';

type RGB = [number, number, number];

const CARD: RGB = [236, 232, 220];
const TABLE: RGB = [28, 25, 23];
const RED: RGB = [210, 40, 40];
const GREEN: RGB = [40, 190, 60];
const BLUE: RGB = [40, 60, 210];
const YELLOW: RGB = [220, 205, 40];

/** A baseball card's shape: 2.5 by 3.5 inches. */
const CARD_WIDTH = 280;
const CARD_HEIGHT = 392;

function inPolygon(x: number, y: number, corners: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i]!;
    const b = corners[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A photo: card colour inside the quad, table colour outside it. */
function photo(
  width: number,
  height: number,
  corners: readonly Point[],
  detail?: (x: number, y: number) => RGB | null,
): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const onCard = inPolygon(px, py, corners);
      const color = (onCard ? detail?.(px, py) : null) ?? (onCard ? CARD : TABLE);
      const at = (y * width + x) * 4;
      data[at] = color[0];
      data[at + 1] = color[1];
      data[at + 2] = color[2];
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A card of the standard size, upright, centred in the frame. */
function centeredCard(width: number, height: number, cardWidth = CARD_WIDTH, cardHeight = CARD_HEIGHT): { corners: Point[]; photo: PixelImage } {
  const corners: Point[] = [
    { x: (width - cardWidth) / 2, y: (height - cardHeight) / 2 },
    { x: (width + cardWidth) / 2, y: (height - cardHeight) / 2 },
    { x: (width + cardWidth) / 2, y: (height + cardHeight) / 2 },
    { x: (width - cardWidth) / 2, y: (height + cardHeight) / 2 },
  ];
  return { corners, photo: photo(width, height, corners) };
}

/** A card turned by `degrees` about its centre. */
function turnedCard(degrees: number, width: number, height: number): Point[] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const half = { x: CARD_WIDTH / 2, y: CARD_HEIGHT / 2 };
  const local: Point[] = [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
  ];
  return local.map((p) => ({
    x: width / 2 + p.x * cos - p.y * sin,
    y: height / 2 + p.x * sin + p.y * cos,
  }));
}

function expectQuadsNear(actual: readonly Point[], expected: readonly Point[], tolerance: number): void {
  expect(actual).toHaveLength(4);
  for (let i = 0; i < 4; i++) {
    const got = actual[i]!;
    const want = expected[i]!;
    const away = Math.hypot(got.x - want.x, got.y - want.y);
    expect(away, `corner ${i}: got (${got.x.toFixed(1)}, ${got.y.toFixed(1)}), want (${want.x}, ${want.y})`).toBeLessThanOrEqual(tolerance);
  }
}

const pixelAt = (img: PixelImage | { data: Uint8ClampedArray; width: number }, x: number, y: number): RGB => {
  const at = (y * img.width + x) * 4;
  return [img.data[at]!, img.data[at + 1]!, img.data[at + 2]!];
};

const near = (got: RGB, want: RGB, tolerance = 30): boolean =>
  got.every((channel, i) => Math.abs(channel - (want[i] ?? 0)) <= tolerance);

/** The share of a warped card that is card, not table. */
function cardShare(img: { data: Uint8ClampedArray; width: number; height: number }): number {
  let onCard = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) if (near(pixelAt(img, x, y), CARD, 40)) onCard++;
  }
  return onCard / (img.width * img.height);
}

describe('detectCardQuad', () => {
  it('finds an upright card and reports its corners', () => {
    const { corners, photo: shot } = centeredCard(420, 560);
    const found = detectCardQuad(shot);
    expect(found).not.toBeNull();
    expectQuadsNear(found!.quad.corners, corners, 7);
    // The card covers about half the frame, and detection says so.
    expect(found!.coverage).toBeGreaterThan(0.42);
    expect(found!.coverage).toBeLessThan(0.52);
  });

  it('returns corners in the coordinates of the photo it was handed', () => {
    // The same card photographed at twice the resolution: the corners come back
    // scaled with the photo, and the card still fills the same share of it.
    const small = centeredCard(420, 560);
    const large = centeredCard(840, 1120, CARD_WIDTH * 2, CARD_HEIGHT * 2);
    const found = detectCardQuad(large.photo);
    expect(found).not.toBeNull();
    expectQuadsNear(found!.quad.corners, large.corners, 12);
    expect(found!.coverage).toBeCloseTo(detectCardQuad(small.photo)!.coverage, 1);
  });

  it('finds a card photographed off-square', () => {
    const corners = turnedCard(12, 460, 600);
    const found = detectCardQuad(photo(460, 600, corners));
    expect(found).not.toBeNull();
    expectQuadsNear(found!.quad.corners, corners, 10);
  });

  it('finds a card shot at an angle', () => {
    // A perspective view: the near edge wider than the far edge.
    const corners: Point[] = [
      { x: 110, y: 90 },
      { x: 330, y: 120 },
      { x: 350, y: 500 },
      { x: 90, y: 470 },
    ];
    const found = detectCardQuad(photo(440, 590, corners));
    expect(found).not.toBeNull();
    expectQuadsNear(found!.quad.corners, corners, 12);
  });

  it('is not fooled by detail printed inside the card', () => {
    const { corners } = centeredCard(420, 560);
    // A dark photo window across the top of the card, like a real card back.
    const shot = photo(420, 560, corners, (x, y) => (y > 120 && y < 220 ? [60, 70, 110] : null));
    const found = detectCardQuad(shot);
    expect(found).not.toBeNull();
    expectQuadsNear(found!.quad.corners, corners, 7);
  });

  it('gives up on a photo with nothing card-shaped in it', () => {
    expect(detectCardQuad(photo(400, 500, []))).toBeNull();
    // A flat grey wall: no edges anywhere, so no outline either.
    const wall: PixelImage = { width: 300, height: 400, data: new Uint8ClampedArray(300 * 400 * 4).fill(120) };
    expect(detectCardQuad(wall)).toBeNull();
    // A bright patch far too small to be a card.
    const speck = photo(400, 500, [
      { x: 180, y: 240 },
      { x: 230, y: 240 },
      { x: 230, y: 290 },
      { x: 180, y: 290 },
    ]);
    expect(detectCardQuad(speck)).toBeNull();
  });
});

describe('warpQuad', () => {
  it('straightens the card to fill the frame, table and all', () => {
    const { corners, photo: shot } = centeredCard(420, 560);
    const found = detectCardQuad(shot)!;
    const warped = warpQuad(shot, found.quad);
    // The card's own size, within a few pixels of the outline.
    expect(warped.width).toBeGreaterThan(CARD_WIDTH - 12);
    expect(warped.width).toBeLessThan(CARD_WIDTH + 12);
    expect(warped.height).toBeGreaterThan(CARD_HEIGHT - 12);
    expect(warped.height).toBeLessThan(CARD_HEIGHT + 12);
    expect(warped.width).toBeLessThan(warped.height); // a card is taller than it is wide
    // The outline sits a pixel or two outside the card, so allow a hair of table.
    expect(cardShare(warped)).toBeGreaterThan(0.96);
    expect(near(pixelAt(warped, Math.floor(warped.width / 2), Math.floor(warped.height / 2)), CARD, 30)).toBe(true);
  });

  it('keeps the top-left of the photo at the top-left of the card', () => {
    const { corners, photo: shot } = centeredCard(420, 560);
    // A colour in each corner of the card, printed the way a card would be.
    const inset = 46;
    const patch = CARD_WIDTH / 3;
    const tl = corners[0]!;
    const colorAt = (x: number, y: number): RGB | null => {
      const left = x < tl.x + inset + patch;
      const right = x > tl.x + CARD_WIDTH - inset - patch;
      const top = y < tl.y + inset + patch;
      const bottom = y > tl.y + CARD_HEIGHT - inset - patch;
      if (left && top) return RED;
      if (right && top) return GREEN;
      if (right && bottom) return BLUE;
      if (left && bottom) return YELLOW;
      return null;
    };
    const marked = photo(420, 560, corners, colorAt);
    const warped = warpQuad(marked, detectCardQuad(marked)!.quad);
    const at = 24;
    expect(near(pixelAt(warped, at, at), RED, 60)).toBe(true);
    expect(near(pixelAt(warped, warped.width - 1 - at, at), GREEN, 60)).toBe(true);
    expect(near(pixelAt(warped, warped.width - 1 - at, warped.height - 1 - at), BLUE, 60)).toBe(true);
    expect(near(pixelAt(warped, at, warped.height - 1 - at), YELLOW, 60)).toBe(true);
  });

  it('stands a sideways card back up', () => {
    // A portrait card lying on its side in a landscape photo.
    const corners: Point[] = [
      { x: 130, y: 190 },
      { x: 130 + CARD_HEIGHT, y: 190 },
      { x: 130 + CARD_HEIGHT, y: 190 + CARD_WIDTH },
      { x: 130, y: 190 + CARD_WIDTH },
    ];
    const shot = photo(660, 660, corners);
    const found = detectCardQuad(shot);
    expect(found).not.toBeNull();
    const warped = warpQuad(shot, found!.quad);
    expect(warped.height).toBeGreaterThan(warped.width);
    expect(warped.width).toBeGreaterThan(CARD_WIDTH - 12);
    expect(cardShare(warped)).toBeGreaterThan(0.96);
  });

  it('maps the unit square onto the quad it was given', () => {
    const quad: Quad = {
      corners: [
        { x: 40, y: 30 },
        { x: 300, y: 60 },
        { x: 280, y: 400 },
        { x: 20, y: 380 },
      ],
    };
    const [a, b, c, d, e, f, g, h] = homography(quad.corners);
    const map = (u: number, v: number): Point => {
      const w = g! * u + h! * v + 1;
      return { x: (a! * u + b! * v + c!) / w, y: (d! * u + e! * v + f!) / w };
    };
    // The unit square's corners land on the quad's corners — and only h33 is fixed.
    expect(map(0, 0).x).toBeCloseTo(40, 6);
    expect(map(0, 0).y).toBeCloseTo(30, 6);
    expect(map(1, 0).x).toBeCloseTo(300, 6);
    expect(map(0, 1).y).toBeCloseTo(380, 6);
    expect(map(1, 1).x).toBeCloseTo(280, 6);
    expect(map(1, 1).y).toBeCloseTo(400, 6);
  });

  it('reports the card’s own width and height from the quad', () => {
    const size = quadSize([
      { x: 10, y: 20 },
      { x: 290, y: 20 },
      { x: 290, y: 412 },
      { x: 10, y: 412 },
    ]);
    expect(size.width).toBeCloseTo(280, 6);
    expect(size.height).toBeCloseTo(392, 6);
  });
});

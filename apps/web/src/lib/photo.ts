/**
 * Photo handling for card entry.
 *
 * Card photos come straight off a phone, so they are prepared in the browser
 * before upload: downscaled, re-encoded, and — when the card's outline can be
 * found — cropped and straightened to the card itself, so the shelf shows the
 * card and not the table it was sitting on. The manager then gets a look at
 * the result and can turn it a quarter at a time before it is saved. If the
 * browser cannot decode the file (some HEIC images), we fall back to sending
 * the original and let the server accept or reject it.
 */
import { detectCardQuad, rotateQuarterTurns, warpQuad } from './cardDetect.js';
import type { Warped } from './cardDetect.js';

const MAX_EDGE = 1400;
const QUALITY = 0.88;

export interface LoadedPhoto {
  /** the whole photo, downscaled */
  full: Warped;
  /** the card cut out and straightened, when its outline was found */
  card: Warped | null;
}

export async function loadCardPhoto(file: File): Promise<LoadedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file');

  // Phones store a sideways sensor image plus an EXIF turn; honour the turn.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot process images');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    const full: Warped = { width, height, data: pixels.data };

    // Best effort: a photo we cannot read keeps its original framing.
    let card: Warped | null = null;
    try {
      const found = detectCardQuad(pixels);
      if (found) card = warpQuad(pixels, found.quad);
    } catch {
      /* no readable outline */
    }
    return { full, card };
  } finally {
    bitmap.close();
  }
}

/** The picture to save: the card (or whole photo), turned by quarter turns clockwise. */
export function framed(photo: LoadedPhoto, useCard: boolean, turns: number): Warped {
  return rotateQuarterTurns(useCard && photo.card ? photo.card : photo.full, turns);
}

function toCanvas(img: Warped): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return canvas;
}

export function previewUrl(img: Warped): string {
  return toCanvas(img).toDataURL('image/jpeg', 0.8);
}

export async function encodeForUpload(img: Warped): Promise<{ file: File; width: number; height: number }> {
  const blob = await new Promise<Blob | null>((resolve) => toCanvas(img).toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Could not process that image');
  return { file: new File([blob], 'card.jpg', { type: 'image/jpeg' }), width: img.width, height: img.height };
}

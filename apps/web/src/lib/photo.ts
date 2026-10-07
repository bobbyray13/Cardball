/**
 * Photo handling for card entry.
 *
 * Card photos come straight off a phone, so they are prepared in the browser
 * before upload: downscaled, re-encoded, and — when the card's outline can be
 * found — cropped to the card itself, so the shelf shows the card and not the
 * table it was sitting on. If the browser cannot decode the file (some HEIC
 * images), we fall back to sending the original and let the server accept or
 * reject it.
 */
import { detectCardQuad, warpQuad } from './cardDetect.js';

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
  /** true when the card's outline was found and the photo cropped to it */
  cropped: boolean;
}

const MAX_EDGE = 1400;
const QUALITY = 0.88;

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file');

  const bitmap = await createImageBitmap(file);
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

    // Find the card and fit the photo to it. Best effort: a photo we cannot
    // read keeps its original framing rather than failing the upload.
    let out = canvas;
    let cropped = false;
    try {
      const pixels = ctx.getImageData(0, 0, width, height);
      const found = detectCardQuad(pixels);
      if (found) {
        const warped = warpQuad(pixels, found.quad);
        const crop = document.createElement('canvas');
        crop.width = warped.width;
        crop.height = warped.height;
        const cropCtx = crop.getContext('2d');
        if (cropCtx) {
          cropCtx.putImageData(new ImageData(new Uint8ClampedArray(warped.data), warped.width, warped.height), 0, 0);
          out = crop;
          cropped = true;
        }
      }
    } catch {
      /* no readable outline: keep the full photo */
    }

    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('Could not process that image');
    return { blob, width: out.width, height: out.height, cropped };
  } finally {
    bitmap.close();
  }
}

/** Resize and crop when we can, otherwise hand back the original untouched. */
export async function photoForUpload(file: File): Promise<{ file: File; width: number; height: number; cropped: boolean }> {
  try {
    const prepared = await preparePhoto(file);
    return {
      file: new File([prepared.blob], 'card.jpg', { type: 'image/jpeg' }),
      width: prepared.width,
      height: prepared.height,
      cropped: prepared.cropped,
    };
  } catch {
    return { file, width: 0, height: 0, cropped: false };
  }
}

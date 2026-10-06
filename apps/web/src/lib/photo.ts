/**
 * Photo handling for card entry.
 *
 * Card photos come straight off a phone, so we downscale and re-encode them in
 * the browser before upload: it keeps uploads quick and well under the server's
 * 8 MB cap. If the browser cannot decode the file (some HEIC images), we fall
 * back to sending the original and let the server accept or reject it.
 */
export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
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

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('Could not process that image');
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

/** Resize when we can, otherwise hand back the original untouched. */
export async function photoForUpload(file: File): Promise<{ file: File; width: number; height: number }> {
  try {
    const prepared = await preparePhoto(file);
    return { file: new File([prepared.blob], 'card.jpg', { type: 'image/jpeg' }), width: prepared.width, height: prepared.height };
  } catch {
    return { file, width: 0, height: 0 };
  }
}

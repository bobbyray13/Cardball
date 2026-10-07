import { useRef, useState } from 'react';
import { api } from '../api.js';
import { photoForUpload } from '../lib/photo.js';
import { Button, ErrorNote } from './ui.js';

/**
 * Picks a photo of a real card, fits it to the card's own outline, resizes it
 * in the browser, uploads it, and reports the photo id back to the caller.
 */
export function PhotoUploader({
  onUploaded,
  label = 'Upload a photo of your card',
  photoId = null,
}: {
  onUploaded: (photoId: number) => void;
  label?: string;
  photoId?: number | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { file: upload, width, height, cropped } = await photoForUpload(file);
      const { photoId: id } = await api.uploadPhoto(upload, { width, height });
      setNote(cropped ? 'Card found — the photo was fitted to its outline.' : 'No card outline found — the full photo was kept.');
      onUploaded(id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {photoId ? (
          <img src={api.photoUrl(photoId)} alt="Your card" className="h-24 w-auto rounded-lg ring-1 ring-white/20" />
        ) : null}
        <div>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <Button type="button" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? 'Uploading…' : photoId ? 'Replace photo' : label}
          </Button>
          <p className="mt-1 text-xs text-chalk/45">JPEG, PNG, or WebP. We shrink it and fit it to the card before sending.</p>
        </div>
      </div>
      {note ? <p className="text-xs text-chalk/55">{note}</p> : null}
      <ErrorNote error={error} />
    </div>
  );
}

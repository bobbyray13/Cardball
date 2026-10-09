import { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { encodeForUpload, framed, loadCardPhoto, previewUrl } from '../lib/photo.js';
import type { LoadedPhoto } from '../lib/photo.js';
import { Button, ErrorNote } from './ui.js';

interface Draft {
  photo: LoadedPhoto;
  useCard: boolean;
  /** quarter turns clockwise */
  turns: number;
}

/**
 * Picks a photo of a real card, fits it to the card's own outline, lets the
 * manager turn it upright, uploads it, and reports the photo id back.
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
  const [draft, setDraft] = useState<Draft | null>(null);

  const preview = useMemo(() => (draft ? previewUrl(framed(draft.photo, draft.useCard, draft.turns)) : null), [draft]);

  async function upload(file: File, size: { width: number; height: number }) {
    const { photoId: id } = await api.uploadPhoto(file, size);
    onUploaded(id);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      let photo: LoadedPhoto | null = null;
      try {
        photo = await loadCardPhoto(file);
      } catch {
        // The browser cannot read this one; the server gets the original.
      }
      if (photo) setDraft({ photo, useCard: photo.card !== null, turns: 0 });
      else await upload(file, { width: 0, height: 0 });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const { file, ...size } = await encodeForUpload(framed(draft.photo, draft.useCard, draft.turns));
      await upload(file, size);
      setDraft(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const turn = (by: number) => setDraft((d) => (d ? { ...d, turns: (d.turns + by + 4) % 4 } : d));

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {draft && preview ? (
        <div className="space-y-2">
          <img src={preview} alt="Your card, ready to save" className="max-h-72 w-auto max-w-full rounded-lg ring-1 ring-white/20" />
          <p className="text-xs text-chalk/55">
            {draft.photo.card
              ? draft.useCard
                ? 'Card found and straightened. Turn it upright if it came out sideways.'
                : 'Showing the whole photo.'
              : 'No card outline found, so the whole photo is kept.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => turn(-1)} disabled={busy} title="Rotate left">
              ⟲ Rotate left
            </Button>
            <Button type="button" size="sm" onClick={() => turn(1)} disabled={busy} title="Rotate right">
              Rotate right ⟳
            </Button>
            {draft.photo.card ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ ...draft, useCard: !draft.useCard, turns: 0 })} disabled={busy}>
                {draft.useCard ? 'Use the whole photo' : 'Crop to the card'}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" onClick={() => void save()} disabled={busy}>
              {busy ? 'Uploading…' : 'Save photo'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {photoId ? (
            <img src={api.photoUrl(photoId)} alt="Your card" className="h-24 w-auto rounded-lg ring-1 ring-white/20" />
          ) : null}
          <div>
            <Button type="button" onClick={() => input.current?.click()} disabled={busy}>
              {busy ? 'Reading photo…' : photoId ? 'Replace photo' : label}
            </Button>
            <p className="mt-1 text-xs text-chalk/45">
              JPEG, PNG, or WebP. We find the card, straighten it, and you can turn it before saving. Your photo becomes the art for
              every copy of this card from this year.
            </p>
          </div>
        </div>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

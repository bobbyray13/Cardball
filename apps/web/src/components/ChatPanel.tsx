import { memo, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@cardball/shared';
import { Button, inputClass } from './ui.js';

/** In-game text chat, with the league's Discord voice invite alongside it. */
export const ChatPanel = memo(function ChatPanel({
  messages,
  meName,
  onSend,
  discordUrl,
  onSetDiscord,
  canEditDiscord,
  presence,
}: {
  messages: ChatMessage[];
  meName: string;
  onSend: (body: string) => Promise<void>;
  discordUrl: string | null;
  onSetDiscord: (url: string | null) => Promise<void>;
  canEditDiscord: boolean;
  presence: { id: number; name: string }[];
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<unknown>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastId = messages.at(-1)?.id ?? 0;

  useEffect(() => {
    // Scroll the message list itself — scrolling the trailing node would yank
    // the whole page on mobile.
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  return (
    <div className="flex h-full min-h-72 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {presence.length > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-chalk/50">
            <span className="h-1.5 w-1.5 rounded-full bg-gold" />
            {presence.map((p) => p.name).join(', ')} in the room
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {discordUrl ? (
            <a href={discordUrl} target="_blank" rel="noreferrer noopener">
              <Button size="sm">Discord voice</Button>
            </a>
          ) : null}
          {canEditDiscord ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
              {discordUrl ? 'Change' : 'Add voice chat'}
            </Button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <form
          className="mb-2 space-y-2 rounded-lg border border-white/10 bg-black/25 p-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await onSetDiscord(url.trim() || null);
              setEditing(false);
              setUrl('');
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input className={inputClass} placeholder="https://discord.gg/your-invite" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" type="submit" disabled={busy}>
              Save
            </Button>
            <Button size="sm" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {error ? <p className="text-xs text-crimson">{error instanceof Error ? error.message : 'Could not save that link'}</p> : null}
        </form>
      ) : null}

      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3" aria-live="polite">
        {messages.length === 0 ? <p className="py-4 text-center text-sm text-chalk/40">Say hello.</p> : null}
        {messages.map((message) => (
          <div key={message.id} className="text-sm">
            <span className={`font-semibold ${message.name === meName ? 'text-gold' : 'text-chalk/70'}`}>{message.name}</span>
            <span className="ml-2 text-chalk/85">{message.body}</span>
          </div>
        ))}
      </div>

      <form
        className="mt-2 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const text = body.trim();
          if (!text) return;
          setBusy(true);
          setError(null);
          try {
            await onSend(text);
            setBody('');
          } catch (err) {
            // Keep the text, so the manager can send it again.
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className={inputClass} placeholder="Message the table…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} />
        <Button type="submit" variant="primary" disabled={busy || !body.trim()}>
          Send
        </Button>
      </form>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-crimson">
          Couldn't send that: {error instanceof Error ? error.message : 'try again'}
        </p>
      ) : null}
    </div>
  );
});

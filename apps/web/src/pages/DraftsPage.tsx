import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DRAFT_LIMITS } from '@cardball/shared';
import type { DraftListItem } from '@cardball/shared';
import { api } from '../api.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';

const PHASE_LABEL: Record<DraftListItem['phase'], string> = {
  lobby: 'Taking seats',
  active: 'Drafting',
  finished: 'Done',
};

const THIS_YEAR = new Date().getFullYear();

export function DraftsPage() {
  const navigate = useNavigate();
  const drafts = useLoad(() => api.drafts(), []);

  const [cardYear, setCardYear] = useState(2004);
  const [rounds, setRounds] = useState(3);
  const [packSize, setPackSize] = useState(8);

  const create = useAction(async () => {
    const { draft } = await api.createDraft({ cardYear, rounds, packSize, playableOnly: true });
    navigate(`/drafts/${draft.id}`);
  });

  const join = useAction(async (id: number) => {
    await api.joinDraft(id);
    navigate(`/drafts/${id}`);
  });

  const list = drafts.data?.drafts ?? [];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-display text-3xl font-bold text-chalk">Drafts</h1>
        <p className="mt-1 max-w-2xl text-sm text-chalk/60">
          Everyone opens a pack, takes one card, and passes the rest along. Every card you take goes straight into your
          collection.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Draft rooms"
          actions={
            <Button size="sm" onClick={drafts.reload} disabled={drafts.loading}>
              Refresh
            </Button>
          }
        >
          <ErrorNote error={drafts.error} />
          <ErrorNote error={join.error} />
          {drafts.loading && !drafts.data ? (
            <Spinner />
          ) : list.length === 0 ? (
            <EmptyState title="No drafts yet">Open a room and send your friends the link.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {list.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                      d.phase === 'active' ? 'bg-crimson/25 text-crimson' : d.phase === 'finished' ? 'bg-white/10 text-chalk/60' : 'bg-gold/20 text-gold'
                    }`}
                  >
                    {PHASE_LABEL[d.phase]}
                  </span>
                  <span className="font-medium text-chalk">
                    {d.cardYear} cards · {d.hostName}'s room
                  </span>
                  <span className="font-mono text-xs text-chalk/50">
                    {d.rounds} × {d.packSize} · {d.seatsFilled}/{d.seats} seats
                  </span>
                  <span className="ml-auto">
                    {d.isMine || d.phase !== 'lobby' ? (
                      <Link to={`/drafts/${d.id}`}>
                        <Button size="sm">{d.isMine ? 'Open' : 'Watch'}</Button>
                      </Link>
                    ) : (
                      <Button size="sm" variant="primary" disabled={join.busy || d.seatsFilled >= d.seats} onClick={() => void join.execute(d.id)}>
                        Take a seat
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Open a draft room" subtitle="Packs are dealt from players who played in the six seasons before the card year.">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create.execute();
            }}
          >
            <Field label="Card year">
              <input
                name="cardYear"
                type="number"
                className={inputClass}
                min={1877}
                max={THIS_YEAR + 1}
                value={cardYear}
                onChange={(e) => setCardYear(Number(e.target.value))}
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Packs each">
                <select name="rounds" className={inputClass} value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
                  {Array.from({ length: DRAFT_LIMITS.maxRounds }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cards per pack">
                <select name="packSize" className={inputClass} value={packSize} onChange={(e) => setPackSize(Number(e.target.value))}>
                  {Array.from({ length: DRAFT_LIMITS.maxPackSize - DRAFT_LIMITS.minPackSize + 1 }, (_, i) => i + DRAFT_LIMITS.minPackSize).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="text-xs text-chalk/50">
              Each manager ends with {rounds * packSize} cards. Rooms seat {DRAFT_LIMITS.minSeats}–{DRAFT_LIMITS.maxSeats} managers.
            </p>
            <ErrorNote error={create.error} />
            <Button type="submit" variant="primary" className="w-full" disabled={create.busy}>
              {create.busy ? 'Shuffling…' : 'Open the room'}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

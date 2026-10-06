import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DRAFT_LIMITS, PACK_THEMES, packTheme, packThemesForYears } from '@cardball/shared';
import type { DraftListItem, PackThemeId } from '@cardball/shared';
import { api } from '../api.js';
import { ERAS, THIS_YEAR, eraById } from '../eras.js';
import { PackArt } from '../components/PackArt.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';

const PHASE_LABEL: Record<DraftListItem['phase'], string> = {
  lobby: 'Taking seats',
  active: 'Drafting',
  finished: 'Done',
};

export function DraftsPage() {
  const navigate = useNavigate();
  const drafts = useLoad(() => api.drafts(), []);

  const [era, setEra] = useState<string>('expansion');
  const [yearFrom, setYearFrom] = useState(1961);
  const [yearTo, setYearTo] = useState(1992);
  const [rounds, setRounds] = useState(3);
  const [packSize, setPackSize] = useState(8);
  const [themes, setThemes] = useState<PackThemeId[]>(['sluggers', 'aces', 'speedsters']);
  const [maxRare, setMaxRare] = useState(0);
  const [maxChase, setMaxChase] = useState(0);

  const offered = useMemo(() => packThemesForYears(yearFrom, yearTo), [yearFrom, yearTo]);
  const offeredIds = useMemo(() => new Set(offered.map((t) => t.id)), [offered]);
  // A theme can fall out of the era when the years change; don't offer it then.
  const chosen = themes.filter((t) => offeredIds.has(t));

  const pickEra = (id: string) => {
    setEra(id);
    const preset = eraById(id);
    if (preset) {
      setYearFrom(preset.from);
      setYearTo(preset.to);
      setThemes((prev) => prev.filter((t) => packThemesForYears(preset.from, preset.to).some((x) => x.id === t)));
    }
  };

  const toggleTheme = (id: PackThemeId) =>
    setThemes((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const create = useAction(async () => {
    const { draft } = await api.createDraft({
      rounds,
      packSize,
      yearFrom,
      yearTo,
      playableOnly: true,
      themes: chosen,
      rarityCaps: maxRare > 0 || maxChase > 0 ? { rare: maxRare, chase: maxChase } : null,
    });
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
          Everyone opens a themed pack, takes one card, and passes the rest along. Tear each wrapper open when it reaches
          you, and every card you take goes straight into your collection.
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
                    {d.yearFrom === d.yearTo ? d.yearFrom : `${d.yearFrom}–${d.yearTo}`} cards · {d.hostName}'s room
                  </span>
                  <span className="flex gap-1">
                    {d.themes.slice(0, 4).map((id) => (
                      <PackArt key={id} theme={packTheme(id)} size="xs" className="shrink-0" />
                    ))}
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

        <Panel title="Open a draft room" subtitle="A pack holds cards built on one year inside the era you pick, and only cards that fit the wrapper's label.">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create.execute();
            }}
          >
            <Field label="Era">
              <select name="era" className={inputClass} value={era} onChange={(e) => pickEra(e.target.value)}>
                {ERAS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label} · {e.from}–{e.to}
                  </option>
                ))}
                <option value="custom">Custom range</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Card years from">
                <input
                  name="yearFrom"
                  type="number"
                  className={inputClass}
                  min={DRAFT_LIMITS.minYear}
                  max={DRAFT_LIMITS.maxYear}
                  value={yearFrom}
                  onChange={(e) => {
                    setYearFrom(Number(e.target.value));
                    setEra('custom');
                  }}
                  required
                />
              </Field>
              <Field label="through">
                <input
                  name="yearTo"
                  type="number"
                  className={inputClass}
                  min={DRAFT_LIMITS.minYear}
                  max={DRAFT_LIMITS.maxYear}
                  value={yearTo}
                  onChange={(e) => {
                    setYearTo(Number(e.target.value));
                    setEra('custom');
                  }}
                  required
                />
              </Field>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium tracking-wide text-chalk/60 uppercase">Packs in the rotation</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {PACK_THEMES.map((t) => {
                  const live = offeredIds.has(t.id);
                  const on = chosen.includes(t.id);
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        name={`theme-${t.id}`}
                        disabled={!live}
                        onClick={() => toggleTheme(t.id)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                          on ? 'border-gold bg-gold/10' : 'border-white/10 bg-black/20 hover:border-white/30'
                        } ${live ? '' : 'cursor-not-allowed opacity-40'}`}
                      >
                        <PackArt theme={t} size="xs" className="shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-chalk">{t.name}</span>
                          <span className="block truncate text-[10px] text-chalk/50">{live ? t.hold : `not dealt in this era`}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {chosen.length === 0 ? <p className="mt-1 text-xs text-chalk/50">No packs chosen — a mixed pack is dealt instead.</p> : null}
            </div>

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

            <div className="grid grid-cols-2 gap-3">
              <Field label="Most rare each (0 = no cap)">
                <input name="maxRare" type="number" className={inputClass} min={0} max={DRAFT_LIMITS.maxRare} value={maxRare} onChange={(e) => setMaxRare(Number(e.target.value))} />
              </Field>
              <Field label="Most chase each (0 = no cap)">
                <input name="maxChase" type="number" className={inputClass} min={0} max={DRAFT_LIMITS.maxChase} value={maxChase} onChange={(e) => setMaxChase(Number(e.target.value))} />
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

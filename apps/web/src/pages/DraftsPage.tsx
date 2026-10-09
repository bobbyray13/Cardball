import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DRAFT_LIMITS, packTheme } from '@cardball/shared';
import type { DraftListItem, PackThemeId } from '@cardball/shared';
import { api } from '../api.js';
import { eraById } from '../eras.js';
import { PackArt } from '../components/PackArt.js';
import { EraRangePicker, PackThemePicker, RarityCapFields, RoundSizeFields, chosenThemes } from '../components/RoomConfig.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';

const PHASE_LABEL: Record<DraftListItem['phase'], string> = {
  lobby: 'Taking seats',
  active: 'Drafting',
  assembling: 'Building lineups',
  playing: 'Series under way',
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
  const [innings, setInnings] = useState(9);
  const [themes, setThemes] = useState<PackThemeId[]>(['sluggers', 'aces', 'speedsters']);
  const [maxRare, setMaxRare] = useState(0);
  const [maxStar, setMaxStar] = useState(0);
  const [maxMythic, setMaxMythic] = useState(0);

  const chosen = chosenThemes(themes, yearFrom, yearTo);

  const pickEra = (id: string) => {
    setEra(id);
    const preset = eraById(id);
    if (preset) {
      setYearFrom(preset.from);
      setYearTo(preset.to);
      setThemes((prev) => chosenThemes(prev, preset.from, preset.to));
    }
  };

  // Editing either year means the range is custom, not one of the presets.
  const setYears = (next: { yearFrom: number; yearTo: number }) => {
    setYearFrom(next.yearFrom);
    setYearTo(next.yearTo);
    setEra('custom');
  };

  const create = useAction(async () => {
    const { draft } = await api.createDraft({
      rounds,
      packSize,
      yearFrom,
      yearTo,
      playableOnly: true,
      themes: chosen,
      rarityCaps: maxRare > 0 || maxStar > 0 || maxMythic > 0 ? { rare: maxRare, star: maxStar, mythic: maxMythic } : null,
      regulationInnings: innings,
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
            <EraRangePicker
              era={era}
              onEraChange={pickEra}
              yearFrom={yearFrom}
              yearTo={yearTo}
              onYearsChange={setYears}
              minYear={DRAFT_LIMITS.minYear}
              maxYear={DRAFT_LIMITS.maxYear}
              yearsRequired
            />

            <PackThemePicker themes={themes} yearFrom={yearFrom} yearTo={yearTo} onChange={setThemes} />

            <RoundSizeFields
              rounds={rounds}
              packSize={packSize}
              onRoundsChange={setRounds}
              onPackSizeChange={setPackSize}
              maxRounds={DRAFT_LIMITS.maxRounds}
              minPackSize={DRAFT_LIMITS.minPackSize}
              maxPackSize={DRAFT_LIMITS.maxPackSize}
            />

            <RarityCapFields
              rare={maxRare}
              star={maxStar}
              mythic={maxMythic}
              onRareChange={setMaxRare}
              onStarChange={setMaxStar}
              onMythicChange={setMaxMythic}
              maxRare={DRAFT_LIMITS.maxRare}
              maxStar={DRAFT_LIMITS.maxStar}
              maxMythic={DRAFT_LIMITS.maxMythic}
            />

            <Field label="Innings per game" hint="The series' games are played to this length.">
              <select name="draftInnings" className={inputClass} value={innings} onChange={(e) => setInnings(Number(e.target.value))}>
                {[3, 6, 9].map((n) => (
                  <option key={n} value={n}>
                    {n} innings
                  </option>
                ))}
              </select>
            </Field>

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

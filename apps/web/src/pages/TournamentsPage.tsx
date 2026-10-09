import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DRAFT_LIMITS, TOURNAMENT_LIMITS, formatLabel } from '@cardball/shared';
import type { PackThemeId, TournamentListItem } from '@cardball/shared';
import { api } from '../api.js';
import type { NewTournament } from '../api.js';
import { eraById } from '../eras.js';
import { EraRangePicker, PackThemePicker, PickClockField, RarityCapFields, RoundSizeFields, SegmentedToggle, chosenThemes } from '../components/RoomConfig.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';
import { useLiveListUpdates } from '../lib/liveList.js';

const STATUS_LABEL: Record<TournamentListItem['status'], string> = {
  lobby: 'Taking seats',
  drafting: 'Drafting',
  playing: 'In play',
  finished: 'Finished',
};

type TournamentFormatChoice = 'round-robin' | 'semis';

const FORMAT_OPTIONS: ReadonlyArray<{ value: TournamentFormatChoice; label: string }> = [
  { value: 'round-robin', label: 'Round robin' },
  { value: 'semis', label: 'Semis + final' },
];

const SEAT_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: TOURNAMENT_LIMITS.minSeats, label: String(TOURNAMENT_LIMITS.minSeats) },
  { value: TOURNAMENT_LIMITS.maxSeats, label: String(TOURNAMENT_LIMITS.maxSeats) },
];

export function TournamentsPage() {
  const navigate = useNavigate();
  const tournaments = useLoad(() => api.tournaments(), []);
  useLiveListUpdates('tournaments', tournaments.reload);

  const [name, setName] = useState('');
  const [format, setFormat] = useState<TournamentFormatChoice>('round-robin');
  const [seats, setSeats] = useState(4);
  const [innings, setInnings] = useState(9);
  const [autoSimulate, setAutoSimulate] = useState(true);
  const [era, setEra] = useState<string>('expansion');
  const [yearFrom, setYearFrom] = useState(1961);
  const [yearTo, setYearTo] = useState(1992);
  const [rounds, setRounds] = useState(4);
  const [packSize, setPackSize] = useState(6);
  const [themes, setThemes] = useState<PackThemeId[]>(['sluggers', 'aces', 'speedsters']);
  const [maxRare, setMaxRare] = useState(0);
  const [maxStar, setMaxStar] = useState(0);
  const [maxMythic, setMaxMythic] = useState(0);
  const [pickClockSeconds, setPickClockSeconds] = useState(0);

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

  const enoughPicks = rounds * packSize >= TOURNAMENT_LIMITS.minPicks;

  const create = useAction(async () => {
    const draft: NewTournament['draft'] = {
      rounds,
      packSize,
      yearFrom,
      yearTo,
      themes: chosen,
      rarityCaps: maxRare > 0 || maxStar > 0 || maxMythic > 0 ? { rare: maxRare, star: maxStar, mythic: maxMythic } : null,
      pickClockSeconds,
    };
    const { tournament } = await api.createTournament({ name, format, seats, regulationInnings: innings, autoSimulate, draft });
    navigate(`/tournaments/${tournament.id}`);
  });

  const join = useAction(async (id: number) => {
    await api.joinTournament(id);
    navigate(`/tournaments/${id}`);
  });

  const list = tournaments.data?.tournaments ?? [];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="font-display text-3xl font-bold text-chalk">Tournaments</h1>
        <p className="mt-1 max-w-2xl text-sm text-chalk/60">
          Three or four managers draft once, and the cards you take are your team — nothing else plays. Then it's a round robin, or
          semifinals, a final, and a third place game. Play the matches live or let the server play them out.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Tournament rooms">
          <ErrorNote error={tournaments.error} />
          <ErrorNote error={join.error} />
          {tournaments.loading && !tournaments.data ? (
            <Spinner />
          ) : list.length === 0 ? (
            <EmptyState title="No tournaments yet">Open a room and deal your friends in.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {list.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                      t.status === 'playing' ? 'bg-crimson/25 text-crimson' : t.status === 'finished' ? 'bg-white/10 text-chalk/60' : 'bg-gold/20 text-gold'
                    }`}
                  >
                    {STATUS_LABEL[t.status]}
                  </span>
                  <span className="font-medium text-chalk">{t.name}</span>
                  <span className="text-xs text-chalk/60">{formatLabel(t.format)}</span>
                  <span className="font-mono text-xs text-chalk/50">
                    {t.era} cards · {t.seatsFilled}/{t.seats} seats · {t.hostName}'s room
                  </span>
                  {t.championName ? <span className="text-xs text-gold">{t.championName} won it</span> : null}
                  <span className="ml-auto">
                    {t.isMine || t.status !== 'lobby' ? (
                      <Link to={`/tournaments/${t.id}`}>
                        <Button size="sm">{t.isMine ? 'Open' : 'Watch'}</Button>
                      </Link>
                    ) : (
                      <Button size="sm" variant="primary" disabled={join.busy || t.seatsFilled >= t.seats} onClick={() => void join.execute(t.id)}>
                        Take a seat
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Open a tournament" subtitle="Each manager's roster is exactly the cards they draft — enough packs to field nine and a bench.">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create.execute();
            }}
          >
            <Field label="Name">
              <input name="name" type="text" className={inputClass} minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="The Autumn Classic" required />
            </Field>

            <Field label="Format">
              <SegmentedToggle namePrefix="format" value={format} options={FORMAT_OPTIONS} onChange={(next) => setFormat(next)} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Managers">
                <SegmentedToggle namePrefix="seats" value={seats} options={SEAT_OPTIONS} onChange={(next) => setSeats(next)} />
              </Field>
              <Field label="Innings">
                <select name="innings" className={inputClass} value={innings} onChange={(e) => setInnings(Number(e.target.value))}>
                  {[3, 6, 9].map((n) => (
                    <option key={n} value={n}>
                      {n} innings
                    </option>
                  ))}
                </select>
              </Field>
            </div>

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
              maxRounds={TOURNAMENT_LIMITS.maxRounds}
              minRounds={TOURNAMENT_LIMITS.minRounds}
              minPackSize={TOURNAMENT_LIMITS.minPackSize}
              maxPackSize={TOURNAMENT_LIMITS.maxPackSize}
            />
            <p className={`text-xs ${enoughPicks ? 'text-chalk/50' : 'text-crimson'}`}>
              Each manager drafts {rounds * packSize} cards{enoughPicks ? '' : ` — a tournament needs at least ${TOURNAMENT_LIMITS.minPicks} each`}.
            </p>

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

            <PickClockField value={pickClockSeconds} onChange={setPickClockSeconds} />

            <label className="flex items-center gap-2 text-sm text-chalk/70">
              <input
                name="autoSimulate"
                type="checkbox"
                checked={autoSimulate}
                onChange={(e) => setAutoSimulate(e.target.checked)}
                className="size-4 accent-gold"
              />
              Play the matches out automatically when they're scheduled
            </label>

            <ErrorNote error={create.error} />
            <Button type="submit" variant="primary" className="w-full" disabled={create.busy || !enoughPicks}>
              {create.busy ? 'Setting up…' : 'Open the tournament'}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}

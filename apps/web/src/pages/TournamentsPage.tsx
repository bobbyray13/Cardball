import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DRAFT_LIMITS, PACK_THEMES, TOURNAMENT_LIMITS, formatLabel, packTheme, packThemesForYears } from '@cardball/shared';
import type { PackThemeId, TournamentListItem } from '@cardball/shared';
import { api } from '../api.js';
import type { NewTournament } from '../api.js';
import { ERAS, eraById } from '../eras.js';
import { PackArt } from '../components/PackArt.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';

const STATUS_LABEL: Record<TournamentListItem['status'], string> = {
  lobby: 'Taking seats',
  drafting: 'Drafting',
  playing: 'In play',
  finished: 'Finished',
};

export function TournamentsPage() {
  const navigate = useNavigate();
  const tournaments = useLoad(() => api.tournaments(), []);

  const [name, setName] = useState('');
  const [format, setFormat] = useState<'round-robin' | 'semis'>('round-robin');
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
  const [maxChase, setMaxChase] = useState(0);

  const offered = useMemo(() => packThemesForYears(yearFrom, yearTo), [yearFrom, yearTo]);
  const offeredIds = useMemo(() => new Set(offered.map((t) => t.id)), [offered]);
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

  const toggleTheme = (id: PackThemeId) => setThemes((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const enoughPicks = rounds * packSize >= TOURNAMENT_LIMITS.minPicks;

  const create = useAction(async () => {
    const draft: NewTournament['draft'] = {
      rounds,
      packSize,
      yearFrom,
      yearTo,
      themes: chosen,
      rarityCaps: maxRare > 0 || maxChase > 0 ? { rare: maxRare, chase: maxChase } : null,
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
        <Panel
          title="Tournament rooms"
          actions={
            <Button size="sm" onClick={tournaments.reload} disabled={tournaments.loading}>
              Refresh
            </Button>
          }
        >
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
              <div className="flex gap-1 rounded-full border border-white/15 p-1">
                {(
                  [
                    ['round-robin', 'Round robin'],
                    ['semis', 'Semis + final'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    name={`format-${value}`}
                    onClick={() => setFormat(value)}
                    className={`flex-1 rounded-full px-2 py-1.5 text-sm transition-colors ${
                      format === value ? 'bg-chalk text-field-deep font-semibold' : 'text-chalk/70 hover:bg-white/10'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Managers">
                <div className="flex gap-1 rounded-full border border-white/15 p-1">
                  {[TOURNAMENT_LIMITS.minSeats, TOURNAMENT_LIMITS.maxSeats].map((n) => (
                    <button
                      key={n}
                      type="button"
                      name={`seats-${n}`}
                      onClick={() => setSeats(n)}
                      className={`flex-1 rounded-full px-2 py-1.5 text-sm transition-colors ${
                        seats === n ? 'bg-chalk text-field-deep font-semibold' : 'text-chalk/70 hover:bg-white/10'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
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
                  {Array.from({ length: TOURNAMENT_LIMITS.maxRounds }, (_, i) => i + TOURNAMENT_LIMITS.minRounds).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cards per pack">
                <select name="packSize" className={inputClass} value={packSize} onChange={(e) => setPackSize(Number(e.target.value))}>
                  {Array.from({ length: TOURNAMENT_LIMITS.maxPackSize - TOURNAMENT_LIMITS.minPackSize + 1 }, (_, i) => i + TOURNAMENT_LIMITS.minPackSize).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className={`text-xs ${enoughPicks ? 'text-chalk/50' : 'text-crimson'}`}>
              Each manager drafts {rounds * packSize} cards{enoughPicks ? '' : ` — a tournament needs at least ${TOURNAMENT_LIMITS.minPicks} each`}.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Most rare each (0 = no cap)">
                <input name="maxRare" type="number" className={inputClass} min={0} max={DRAFT_LIMITS.maxRare} value={maxRare} onChange={(e) => setMaxRare(Number(e.target.value))} />
              </Field>
              <Field label="Most chase each (0 = no cap)">
                <input name="maxChase" type="number" className={inputClass} min={0} max={DRAFT_LIMITS.maxChase} value={maxChase} onChange={(e) => setMaxChase(Number(e.target.value))} />
              </Field>
            </div>

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

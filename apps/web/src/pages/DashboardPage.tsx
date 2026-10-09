import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MATCH_LIMITS, matchCapsLabel, matchEraLabel } from '@cardball/shared';
import type { GameListItem, MatchRules } from '@cardball/shared';
import { api } from '../api.js';
import { ZoomableCard } from '../components/CardZoom.js';
import { EraRangePicker, RarityCapFields, SegmentedToggle } from '../components/RoomConfig.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';
import { eraById } from '../eras.js';
import { useSession } from '../session.js';

const STATUS_LABEL: Record<GameListItem['status'], string> = {
  open: 'Open seat',
  lobby: 'In the lobby',
  live: 'In progress',
  finished: 'Final',
};

type GameMode = 'remote' | 'hotseat' | 'bot';

const MODE_OPTIONS: ReadonlyArray<{ value: GameMode; label: string }> = [
  { value: 'remote', label: 'Remote' },
  { value: 'hotseat', label: 'Hotseat' },
  { value: 'bot', label: 'Vs. bot' },
];

/** A one-line summary of what a match allows, for the room list. */
function matchSummary(match: MatchRules): string {
  const era = matchEraLabel(match);
  const caps = matchCapsLabel(match);
  return caps ? `${era} · ${caps}` : era;
}

function GameRow({ game }: { game: GameListItem }) {
  return (
    <li>
      <Link
        to={`/games/${game.id}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 transition-colors hover:border-gold/40 hover:bg-black/30"
      >
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
            game.status === 'live' ? 'bg-crimson/25 text-crimson' : game.status === 'finished' ? 'bg-white/10 text-chalk/60' : 'bg-gold/20 text-gold'
          }`}
        >
          {STATUS_LABEL[game.status]}
        </span>
        <span className="font-medium text-chalk">
          {game.home && game.away ? `${game.away.name} at ${game.home.name}` : `${game.hostName} needs an opponent`}
        </span>
        {game.home && game.away ? (
          <span className="font-mono text-sm text-chalk/70">
            {game.away.score}–{game.home.score}
          </span>
        ) : null}
        <span className="font-mono text-xs text-chalk/45">
          {game.inning ? `${game.half === 'top' ? '▲' : '▼'} ${game.inning}` : `${game.regulationInnings} inn`} · {game.mode}
        </span>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] tracking-wide text-chalk/60 uppercase">{matchSummary(game.match)}</span>
        {game.locked ? (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] tracking-wide text-chalk/60 uppercase" title="Watching or joining takes a password">
            password
          </span>
        ) : null}
        {!game.isMine && game.status !== 'open' ? <span className="ml-auto text-xs text-gold/80">Watch →</span> : null}
      </Link>
    </li>
  );
}

export function DashboardPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const games = useLoad(() => api.games(), []);
  const teams = useLoad(() => api.teams(), []);
  const collection = useLoad(() => api.collection(), []);
  const stockTeams = useLoad(() => api.stockTeams(), []);

  const [mode, setMode] = useState<GameMode>('remote');
  const [innings, setInnings] = useState(9);
  const [teamId, setTeamId] = useState<number | ''>('');
  // The opponent, as "team:<id>" or "stock:<id>" so one control covers both.
  const [opponent, setOpponent] = useState('');
  const [joinTeamId, setJoinTeamId] = useState<number | ''>('');
  // Match rules: which years of cards are allowed, and how many specials.
  const [era, setEra] = useState('any');
  const [yearFrom, setYearFrom] = useState<number>(MATCH_LIMITS.minYear);
  const [yearTo, setYearTo] = useState<number>(MATCH_LIMITS.maxYear);
  const [maxRare, setMaxRare] = useState(0);
  const [maxStar, setMaxStar] = useState(0);
  const [maxMythic, setMaxMythic] = useState(0);
  const [password, setPassword] = useState('');

  // "Any era" means the whole range, and sends no match at all when no cap is
  // set, so an ordinary game carries no restriction.
  const restricted = era !== 'any' || maxRare > 0 || maxStar > 0 || maxMythic > 0;

  const pickEra = (id: string) => {
    setEra(id);
    const preset = eraById(id);
    if (preset) {
      setYearFrom(preset.from);
      setYearTo(preset.to);
    }
  };

  // Editing either year means the range is custom, not one of the presets.
  const setYears = (next: { yearFrom: number; yearTo: number }) => {
    setYearFrom(next.yearFrom);
    setYearTo(next.yearTo);
    setEra('custom');
  };

  const create = useAction(async () => {
    // A stock team is bot-only; a hotseat opponent is always one of your own.
    const opponentPick =
      mode === 'remote'
        ? {}
        : opponent.startsWith('stock:')
          ? { opponentStockTeamId: opponent.slice('stock:'.length) }
          : { opponentTeamId: Number(opponent.slice('team:'.length)) || Number(teamId) };
    const created = await api.createGame({
      mode,
      regulationInnings: innings,
      teamId: Number(teamId),
      ...opponentPick,
      ...(password.trim() ? { password: password.trim() } : {}),
      ...(restricted
        ? {
            match: {
              yearFrom: era === 'any' ? MATCH_LIMITS.minYear : yearFrom,
              yearTo: era === 'any' ? MATCH_LIMITS.maxYear : yearTo,
              rarityCaps:
                maxRare > 0 || maxStar > 0 || maxMythic > 0
                  ? {
                      rare: maxRare > 0 ? maxRare : MATCH_LIMITS.maxRare,
                      star: maxStar > 0 ? maxStar : MATCH_LIMITS.maxStar,
                      mythic: maxMythic > 0 ? maxMythic : MATCH_LIMITS.maxMythic,
                    }
                  : null,
            },
          }
        : {}),
    });
    navigate(`/games/${created.game.id}`);
  });

  const join = useAction(async (game: GameListItem) => {
    // A protected seat asks for the password in the room, then offers the join.
    if (!game.locked) await api.joinGame(game.id, Number(joinTeamId));
    navigate(`/games/${game.id}`);
  });

  const allGames = games.data?.games ?? [];
  const mine = allGames.filter((g) => g.isMine);
  const league = allGames.filter((g) => !g.isMine && g.status !== 'open');
  const myTeams = teams.data?.teams ?? [];
  const cards = collection.data?.cards ?? [];
  const ready = myTeams.filter((t) => t.hasLineup).length;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-chalk">The Lobby</h1>
          <p className="mt-1 text-sm text-chalk/60">
            Welcome back, {user?.displayName}. {ready} of {myTeams.length} teams have a lineup set.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/search">
            <Button variant="primary">Find cards</Button>
          </Link>
          <Link to="/teams">
            <Button>Build a team</Button>
          </Link>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Your games"
          subtitle="Open seats are joinable by anyone in the league."
          actions={
            <Button size="sm" onClick={games.reload} disabled={games.loading}>
              Refresh
            </Button>
          }
        >
          <ErrorNote error={games.error} />
          {games.loading && !games.data ? (
            <Spinner />
          ) : mine.length === 0 ? (
            <EmptyState title="No games yet">Start one here, or build a team first.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {mine.map((game) => (
                <GameRow key={game.id} game={game} />
              ))}
            </ul>
          )}
          {league.length > 0 ? (
            <div className="mt-6">
              <h3 className="mb-1 font-display text-lg font-semibold text-chalk">Around the league</h3>
              <p className="mb-3 text-xs text-chalk/50">Anyone signed in can watch and talk. A game with a password asks for it first.</p>
              <ul className="space-y-2">
                {league.slice(0, 25).map((game) => (
                  <GameRow key={game.id} game={game} />
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>

        <div className="space-y-6">
          <Panel title="Start a game">
            {myTeams.length === 0 ? (
              <EmptyState title="No teams yet">
                <Link className="text-gold underline" to="/teams">
                  Build your first team
                </Link>{' '}
                from cards in your collection.
              </EmptyState>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create.execute();
                }}
              >
                <Field label="How are you playing?">
                  <SegmentedToggle
                    namePrefix="mode"
                    value={mode}
                    options={MODE_OPTIONS}
                    onChange={(next) => {
                      setMode(next);
                      setOpponent('');
                    }}
                  />
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

                <EraRangePicker
                  label="Cards allowed"
                  hint="Both rosters are checked against this before the first pitch."
                  selectName="matchEra"
                  anyEraRange={{ from: MATCH_LIMITS.minYear, to: MATCH_LIMITS.maxYear }}
                  era={era}
                  onEraChange={pickEra}
                  yearFrom={yearFrom}
                  yearTo={yearTo}
                  onYearsChange={setYears}
                  minYear={MATCH_LIMITS.minYear}
                  maxYear={MATCH_LIMITS.maxYear}
                />
                <RarityCapFields
                  rare={maxRare}
                  star={maxStar}
                  mythic={maxMythic}
                  onRareChange={setMaxRare}
                  onStarChange={setMaxStar}
                  onMythicChange={setMaxMythic}
                  maxRare={MATCH_LIMITS.maxRare}
                  maxStar={MATCH_LIMITS.maxStar}
                  maxMythic={MATCH_LIMITS.maxMythic}
                />

                <Field label="Your team">
                  <select name="teamId" className={inputClass} value={teamId} onChange={(e) => setTeamId(Number(e.target.value))} required>
                    <option value="">Pick a team…</option>
                    {myTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.hasLineup ? '' : '(no lineup)'}
                      </option>
                    ))}
                  </select>
                </Field>

                {mode !== 'remote' ? (
                  <Field
                    label="Opponent"
                    hint={mode === 'bot' ? 'The bot manages this team. Stock teams are ready-made opponents.' : 'You manage both sides.'}
                  >
                    <select name="opponent" className={inputClass} value={opponent} onChange={(e) => setOpponent(e.target.value)} required>
                      <option value="">Pick a team…</option>
                      <optgroup label="Your teams">
                        {myTeams
                          .filter((t) => t.id !== teamId)
                          .map((t) => (
                            <option key={`team:${t.id}`} value={`team:${t.id}`}>
                              {t.name} {t.hasLineup ? '' : '(no lineup)'}
                            </option>
                          ))}
                      </optgroup>
                      {mode === 'bot' && (stockTeams.data?.teams.length ?? 0) > 0 ? (
                        <optgroup label="Stock teams">
                          {(stockTeams.data?.teams ?? []).map((t) => (
                            <option key={`stock:${t.id}`} value={`stock:${t.id}`}>
                              {t.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                    {mode === 'bot' && (stockTeams.data?.teams.length ?? 0) > 0 ? (
                      <p className="mt-1 text-xs text-chalk/45">No second team? Pick any stock team and the bot will manage it.</p>
                    ) : null}
                  </Field>
                ) : (
                  <p className="text-xs text-chalk/50">
                    Your game appears with an open seat. Anyone in the league can join with one of their teams.
                  </p>
                )}

                <Field label="Password (optional)" hint="Leave it blank and anyone in the league can watch. Set one and only people you tell can watch or join.">
                  <input
                    name="gamePassword"
                    type="text"
                    autoComplete="off"
                    className={inputClass}
                    maxLength={100}
                    placeholder="No password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>

                <ErrorNote error={create.error} />
                <Button type="submit" variant="primary" className="w-full" disabled={create.busy || !teamId || (mode !== 'remote' && !opponent)}>
                  {create.busy ? 'Setting the field…' : 'Play ball'}
                </Button>
              </form>
            )}
          </Panel>

          <Panel title="Join a game">
            {myTeams.length === 0 ? (
              <p className="text-sm text-chalk/55">Build a team to join a game.</p>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const open = games.data?.games.find((g) => g.status === 'open' && !g.isMine);
                  if (open) void join.execute(open);
                }}
              >
                <Field label="Your team">
                  <select name="joinTeamId" className={inputClass} value={joinTeamId} onChange={(e) => setJoinTeamId(Number(e.target.value))} required>
                    <option value="">Pick a team…</option>
                    {myTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="space-y-2">
                  {(games.data?.games ?? []).filter((g) => g.status === 'open' && !g.isMine).length === 0 ? (
                    <p className="text-sm text-chalk/55">No open seats right now.</p>
                  ) : (
                    (games.data?.games ?? [])
                      .filter((g) => g.status === 'open' && !g.isMine)
                      .map((g) => (
                        <Button
                          key={g.id}
                          type="button"
                          className="w-full"
                          disabled={!joinTeamId || join.busy}
                          onClick={() => void join.execute(g)}
                        >
                          Join {g.hostName}'s {g.regulationInnings}-inning game · {matchSummary(g.match)}
                          {g.locked ? ' · password' : ''}
                        </Button>
                      ))
                  )}
                </div>
                <ErrorNote error={join.error} />
              </form>
            )}
          </Panel>
        </div>
      </div>

      {cards.length > 0 ? (
        <Panel title="Recently collected" actions={<Link to="/collection" className="text-sm text-gold hover:underline">See all {cards.length}</Link>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {cards.slice(-6).map((entry) => (
              <ZoomableCard key={entry.id} target={{ card: entry.card, photoId: entry.photoId, rarity: entry.rarity, userCardId: entry.id }} />
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

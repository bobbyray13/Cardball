import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GameListItem } from '@cardball/shared';
import { api } from '../api.js';
import { BallCard } from '../components/BallCard.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';
import { useSession } from '../session.js';

const STATUS_LABEL: Record<GameListItem['status'], string> = {
  open: 'Open seat',
  lobby: 'In the lobby',
  live: 'In progress',
  finished: 'Final',
};

export function DashboardPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const games = useLoad(() => api.games(), []);
  const teams = useLoad(() => api.teams(), []);
  const collection = useLoad(() => api.collection(), []);

  const [mode, setMode] = useState<'remote' | 'hotseat' | 'bot'>('remote');
  const [innings, setInnings] = useState(9);
  const [teamId, setTeamId] = useState<number | ''>('');
  const [opponentTeamId, setOpponentTeamId] = useState<number | ''>('');
  const [joinTeamId, setJoinTeamId] = useState<number | ''>('');

  const create = useAction(async () => {
    const created = await api.createGame({
      mode,
      regulationInnings: innings,
      teamId: Number(teamId),
      ...(mode === 'remote' ? {} : { opponentTeamId: Number(opponentTeamId || teamId) }),
    });
    navigate(`/games/${created.game.id}`);
  });

  const join = useAction(async (gameId: number) => {
    await api.joinGame(gameId, Number(joinTeamId));
    navigate(`/games/${gameId}`);
  });

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
          ) : (games.data?.games.length ?? 0) === 0 ? (
            <EmptyState title="No games yet">Start one below, or build a team first.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {games.data!.games.map((game) => (
                <li key={game.id}>
                  <Link
                    to={`/games/${game.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 transition-colors hover:border-gold/40 hover:bg-black/30"
                  >
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                        game.status === 'live'
                          ? 'bg-crimson/25 text-crimson'
                          : game.status === 'finished'
                            ? 'bg-white/10 text-chalk/60'
                            : 'bg-gold/20 text-gold'
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
                    {game.inning ? (
                      <span className="font-mono text-xs text-chalk/45">
                        {game.half === 'top' ? '▲' : '▼'} {game.inning} · {game.mode}
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-chalk/45">
                        {game.regulationInnings} inn · {game.mode}
                      </span>
                    )}
                    {game.isMine ? <span className="text-xs text-chalk/45">yours</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
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
                  <div className="flex gap-1 rounded-full border border-white/15 p-1">
                    {(
                      [
                        ['remote', 'Remote'],
                        ['hotseat', 'Hotseat'],
                        ['bot', 'Vs. bot'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        name={`mode-${value}`}
                        onClick={() => setMode(value)}
                        className={`flex-1 rounded-full px-2 py-1.5 text-sm transition-colors ${
                          mode === value ? 'bg-chalk text-field-deep font-semibold' : 'text-chalk/70 hover:bg-white/10'
                        }`}
                      >
                        {label}
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
                  <Field label="Opponent" hint={mode === 'bot' ? 'The bot manages this team.' : 'You manage both sides.'}>
                    <select name="opponentTeamId" className={inputClass} value={opponentTeamId} onChange={(e) => setOpponentTeamId(Number(e.target.value))} required>
                      <option value="">Pick a team…</option>
                      {myTeams
                        .filter((t) => t.id !== teamId)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                ) : (
                  <p className="text-xs text-chalk/50">
                    Your game appears with an open seat. Anyone in the league can join with one of their teams.
                  </p>
                )}

                <ErrorNote error={create.error} />
                <Button type="submit" variant="primary" className="w-full" disabled={create.busy || !teamId}>
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
                  if (open) void join.execute(open.id);
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
                          onClick={() => void join.execute(g.id)}
                        >
                          Join {g.hostName}'s {g.regulationInnings}-inning game
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
              <BallCard key={entry.id} card={entry.card} photoId={entry.photoId} rarity={entry.rarity} />
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

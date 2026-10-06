import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ChatMessage, GameAction, TeamSummary } from '@cardball/shared';
import { sidesFor, waitingOn } from '@cardball/engine';
import type { GameEvent, GameState, Side } from '@cardball/engine';
import { api } from '../api.js';
import type { GameRoom } from '../api.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { DecisionControls } from '../components/DecisionControls.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { Field } from '../components/Field.js';
import { LineScore } from '../components/LineScore.js';
import { PlayByPlay } from '../components/PlayByPlay.js';
import { Button, EmptyState, ErrorNote, Panel, Spinner, inputClass, useLoad } from '../components/ui.js';
import { useSession } from '../session.js';

export function GamePage() {
  const gameId = Number(useParams().id);
  const { user } = useSession();
  const initial = useLoad(() => api.game(gameId), [gameId]);

  const [game, setGame] = useState<GameRoom | null>(null);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [presence, setPresence] = useState<{ id: number; name: string }[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!initial.data) return;
    setGame(initial.data.game);
    setEvents(initial.data.events as GameEvent[]);
    setChat(initial.data.chat);
  }, [initial.data]);

  const appendEvents = useCallback((incoming: GameEvent[]) => {
    if (incoming.length === 0) return;
    setEvents((current) => {
      const bySeq = new Map(current.map((e) => [e.seq, e]));
      for (const event of incoming) bySeq.set(event.seq, event);
      return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  // Live updates: the server broadcasts to everyone in the game room, including us.
  useEffect(() => {
    if (!Number.isFinite(gameId)) return;
    const socket: Socket = io({ path: '/socket.io', withCredentials: true });

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('game:join', gameId, (response: { ok: boolean; data?: { game: GameRoom; events: GameEvent[]; chat: ChatMessage[] } }) => {
        if (response.ok && response.data) {
          setGame(response.data.game);
          appendEvents(response.data.events);
          setChat(response.data.chat);
        }
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('game:update', (payload: { game: GameRoom; events: GameEvent[] }) => {
      setGame(payload.game);
      appendEvents(payload.events);
    });
    socket.on('chat:message', (payload: { message: ChatMessage }) => {
      setChat((current) => (current.some((m) => m.id === payload.message.id) ? current : [...current, payload.message]));
    });
    socket.on('game:presence', (payload: { users: { id: number; name: string }[] }) => setPresence(payload.users));

    return () => {
      socket.emit('game:leave', gameId);
      socket.close();
    };
  }, [gameId, appendEvents]);

  const runAction = useCallback(
    async (action: GameAction) => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.action(gameId, action);
        setGame(result.game);
        appendEvents(result.events as GameEvent[]);
      } catch (err) {
        setError(err);
      } finally {
        setBusy(false);
      }
    },
    [gameId, appendEvents],
  );

  const sendChat = useCallback(
    async (body: string) => {
      const { message } = await api.chat(gameId, body);
      setChat((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
    },
    [gameId],
  );

  const setDiscord = useCallback(
    async (url: string | null) => {
      const { game: updated } = await api.setDiscord(gameId, url);
      setGame(updated);
    },
    [gameId],
  );

  const state = game?.state ?? null;
  const mySides = useMemo<Side[]>(() => (state && user ? sidesFor(state, { userId: user.id }) : []), [state, user]);

  if (initial.loading && !game) return <Spinner label="Finding your seat…" />;
  if (initial.error) return <ErrorNote error={initial.error} />;
  if (!game) return <EmptyState title="Game not found" />;

  const waiting = state ? waitingOn(state) : null;

  return (
    <div className="space-y-4">
      <GameHeader game={game} state={state} connected={connected} waiting={waiting} />

      {game.status === 'open' ? (
        <OpenSeat game={game} onJoined={setGame} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {state ? (
              <>
                {game.status === 'lobby' ? <LobbyPanel game={game} state={state} mySides={mySides} onAction={runAction} busy={busy} /> : null}

                <Panel title="The mat" subtitle={state.phase === 'finished' ? 'Final' : `${state.half === 'top' ? 'Top' : 'Bottom'} ${state.inning} · ${state.outs} out${state.outs === 1 ? '' : 's'}`}>
                  <ErrorBoundary label="The field">
                    <Field state={state} photos={game.photos} />
                  </ErrorBoundary>
                </Panel>

                <Panel title="Your move" subtitle={waiting && mySides.includes(waiting.side) ? waiting.prompt : undefined}>
                  <ErrorNote error={error} />
                  <ErrorBoundary label="The decision panel">
                    <DecisionControls state={state} mySides={mySides} onAction={(a) => void runAction(a)} busy={busy} />
                  </ErrorBoundary>
                  {mySides.length > 0 && state.phase === 'live' ? (
                    <div className="mt-4 border-t border-white/10 pt-3">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => {
                          if (confirm('Concede this game?')) {
                            void runAction({ type: 'concede', ...(mySides.length === 2 ? { side: 'home' as const } : {}) });
                          }
                        }}
                      >
                        Concede
                      </Button>
                    </div>
                  ) : null}
                </Panel>

                <Panel title="Line score">
                  <LineScore state={state} events={events} />
                </Panel>
              </>
            ) : null}
          </div>

          <div className="space-y-4">
            <Panel title="Play by play">
              <PlayByPlay events={events} />
            </Panel>

            <Panel title="Table talk">
              <ChatPanel
                messages={chat}
                meName={user?.displayName ?? ''}
                onSend={sendChat}
                discordUrl={game.discordUrl}
                onSetDiscord={setDiscord}
                canEditDiscord={game.hostUserId === user?.id || game.guestUserId === user?.id}
                presence={presence}
              />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function GameHeader({
  game,
  state,
  connected,
  waiting,
}: {
  game: GameRoom;
  state: GameState | null;
  connected: boolean;
  waiting: { side: Side; kind: string; prompt: string } | null;
}) {
  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <Link to="/" className="text-sm text-chalk/50 hover:text-chalk">
        ← Lobby
      </Link>

      {state ? (
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-display text-xl font-bold text-chalk">{state.away.name}</span>
          <span className="font-mono text-2xl font-bold tabular-nums text-gold">{state.away.score}</span>
          <span className="text-chalk/40">at</span>
          <span className="font-mono text-2xl font-bold tabular-nums text-gold">{state.home.score}</span>
          <span className="font-display text-xl font-bold text-chalk">{state.home.name}</span>
          {state.phase === 'finished' ? (
            <span className="rounded-full bg-gold/20 px-3 py-1 text-xs font-semibold text-gold">
              Final — {state.winner === 'home' ? state.home.name : state.away.name} win
              {state.endedBy === 'concede' ? ' by concession' : ''}
            </span>
          ) : (
            <span className="font-mono text-xs text-chalk/50">
              {state.half === 'top' ? '▲' : '▼'} {state.inning} · {state.outs} out{state.outs === 1 ? '' : 's'}
              {waiting ? ` · ${waiting.kind.replace('-', ' ')}` : ''}
            </span>
          )}
        </div>
      ) : (
        <span className="text-sm text-chalk/60">Waiting for an opponent</span>
      )}

      <div className="ml-auto flex items-center gap-3 text-xs">
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-chalk/60">
          {game.mode} · {game.regulationInnings} inn
        </span>
        <span className={`flex items-center gap-1.5 ${connected ? 'text-gold' : 'text-chalk/40'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-gold' : 'bg-chalk/40'}`} />
          {connected ? 'live' : 'reconnecting'}
        </span>
      </div>
    </div>
  );
}

/** The lobby: both managers press play before the first pitch. */
function LobbyPanel({
  game,
  state,
  mySides,
  onAction,
  busy,
}: {
  game: GameRoom;
  state: GameState;
  mySides: Side[];
  onAction: (action: GameAction) => Promise<void>;
  busy: boolean;
}) {
  const ready = new Set(game.ready);
  const iAmReady = mySides.some((side) => ready.has(side));
  const needsBoth = game.mode === 'remote';

  return (
    <Panel
      title="The lineup card"
      subtitle={
        needsBoth
          ? 'Both managers press play to begin. Dice decide who is home.'
          : 'Dice decide who is home, then the first pitch is thrown.'
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {(['away', 'home'] as const).map((side) => (
          <div key={side} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-display font-semibold text-chalk">{state[side].name}</h3>
              <span className="font-mono text-[10px] tracking-wide text-chalk/40 uppercase">{side}</span>
            </div>
            <ol className="mt-2 space-y-0.5 font-mono text-xs">
              {state[side].lineup.map((playerId, i) => {
                const player = state[side].players.find((p) => p.id === playerId);
                if (!player) return null;
                return (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="w-3 text-chalk/35">{i + 1}</span>
                    <span className="truncate text-chalk/80">{player.name}</span>
                    <span className="ml-auto shrink-0 text-chalk/45">{player.fieldPosition ?? 'DH'}</span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 border-t border-white/10 pt-2 font-mono text-xs text-chalk/60">
              SP {state[side].players.find((p) => p.id === state[side].activePitcherId)?.name ?? '—'}
            </p>
          </div>
        ))}
      </div>

      {mySides.length === 0 ? (
        <p className="text-sm text-chalk/50">Both managers are set. Waiting for them to start.</p>
      ) : iAmReady && needsBoth ? (
        <p className="text-sm text-gold">You are ready. Waiting for the other manager…</p>
      ) : (
        <Button variant="primary" disabled={busy} onClick={() => void onAction({ type: 'start-game' })}>
          {busy ? 'Rolling…' : 'Play ball'}
        </Button>
      )}

      {needsBoth ? (
        <p className="mt-3 font-mono text-xs text-chalk/45">
          ready: {game.ready.length === 0 ? 'nobody yet' : game.ready.join(', ')}
        </p>
      ) : null}
    </Panel>
  );
}

/** An open seat: the host waits, a visitor picks a team to join with. */
function OpenSeat({ game, onJoined }: { game: GameRoom; onJoined: (game: GameRoom) => void }) {
  const { user } = useSession();
  const teams = useLoad(() => api.teams(), []);
  const [teamId, setTeamId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const isMine = game.hostUserId === user?.id;
  const myTeams: TeamSummary[] = teams.data?.teams ?? [];

  if (isMine) {
    return (
      <Panel title="Your game is posted" subtitle="It is listed in the lobby with an open seat.">
        <p className="text-sm text-chalk/60">
          Send your friend to the Lobby and they can join with one of their teams. The dice decide who is home once both of you press play.
        </p>
        <div className="mt-4 flex gap-2">
          <Link to="/">
            <Button>Back to the lobby</Button>
          </Link>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Take the open seat" subtitle="Pick which of your teams plays this game.">
      {myTeams.length === 0 ? (
        <EmptyState title="You need a team first">
          <Link className="text-gold underline" to="/teams">
            Build a team
          </Link>
        </EmptyState>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const { game: joined } = await api.joinGame(game.id, Number(teamId));
              onJoined(joined);
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <select className={inputClass} value={teamId} onChange={(e) => setTeamId(Number(e.target.value))} required>
            <option value="">Pick a team…</option>
            {myTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} {team.hasLineup ? '' : '(no lineup — we will pick one)'}
              </option>
            ))}
          </select>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" disabled={!teamId || busy}>
            {busy ? 'Taking the field…' : 'Join this game'}
          </Button>
        </form>
      )}
    </Panel>
  );
}

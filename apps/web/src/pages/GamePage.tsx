import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { motion } from 'framer-motion';
import type { ChatMessage, DraftView, GameAction, PackView, SavedLineup, TeamSummary } from '@cardball/shared';
import { MATCH_LIMITS, matchCapsLabel, matchEraLabel, matchIsOpen } from '@cardball/shared';
import { canSubstituteNow, sidesFor, waitingOn } from '@cardball/engine';
import type { GameEvent, GameState, Side, TeamState } from '@cardball/engine';
import { ApiError, api } from '../api.js';
import type { GameRoom } from '../api.js';
import { BenchPanel } from '../components/BenchPanel.js';
import { BoxScore } from '../components/BoxScore.js';
import { CardZoom } from '../components/CardZoom.js';
import type { ZoomTarget } from '../components/CardZoom.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { DecisionControls } from '../components/DecisionControls.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { Field } from '../components/Field.js';
import type { ZoomPlayer } from '../components/Field.js';
import { LatestPlay } from '../components/LatestPlay.js';
import { LineupBuilder, lineupProblem } from '../components/LineupBuilder.js';
import type { LineupCandidate } from '../components/LineupBuilder.js';
import { zoomForPlayer } from '../components/gameZoom.js';
import { LineScore } from '../components/LineScore.js';
import { PlayByPlay } from '../components/PlayByPlay.js';
import { Button, EmptyState, ErrorNote, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';
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
  const [zoom, setZoom] = useState<ZoomTarget | null>(null);
  // Bumped after a password opens the room, so the socket joins again.
  const [admitted, setAdmitted] = useState(0);

  useEffect(() => {
    if (!initial.data) return;
    setGame(initial.data.game);
    setEvents(initial.data.events as GameEvent[]);
    setChat(initial.data.chat);
  }, [initial.data]);

  const appendEvents = useCallback((incoming: GameEvent[]) => {
    if (incoming.length === 0) return;
    setEvents((current) => {
      const seen = new Set(current.map((e) => e.seq));
      const fresh = incoming.filter((e) => !seen.has(e.seq)).sort((a, b) => a.seq - b.seq);
      if (fresh.length === 0) return current;
      // The ledger is kept sorted, so each new event splices into place
      // instead of re-sorting the whole game on every pitch.
      const merged = [...current];
      for (const event of fresh) {
        let i = merged.length;
        while (i > 0 && (merged[i - 1]?.seq ?? 0) > event.seq) i--;
        merged.splice(i, 0, event);
      }
      return merged;
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
  }, [gameId, appendEvents, admitted]);

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

  // Same as runAction, but rethrows so a form (the lobby lineup editor) can
  // show the server's validation error in its own words.
  const runActionOrThrow = useCallback(
    async (action: GameAction) => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.action(gameId, action);
        setGame(result.game);
        appendEvents(result.events as GameEvent[]);
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

  // One stable handler for the decision panel, so it only re-renders when the
  // game state does — not on every chat message or presence ping.
  const dispatchAction = useCallback((action: GameAction) => void runAction(action), [runAction]);

  const setDiscord = useCallback(
    async (url: string | null) => {
      const { game: updated } = await api.setDiscord(gameId, url);
      setGame(updated);
    },
    [gameId],
  );

  const state = game?.state ?? null;
  const mySides = useMemo<Side[]>(() => (state && user ? sidesFor(state, { userId: user.id }) : []), [state, user]);
  const finished = state?.phase === 'finished';
  // Did the signed-in manager win this one? Decides the draft-room pack nudge.
  const iWonGame = !!finished && state !== null && state.winner !== null && state[state.winner].userId === (user?.id ?? null);
  // Once the final out is recorded, fetch the shelf so the curtain call can
  // name the packs this game earned.
  const shelf = useLoad(() => (finished ? api.packs() : Promise.resolve(null)), [finished]);
  const earned = useMemo(
    () => (finished && shelf.data ? shelf.data.packs.filter((p) => p.rewardKey?.startsWith(`game:${gameId}#`)) : []),
    [finished, shelf.data, gameId],
  );
  const zoomPlayer = useCallback<ZoomPlayer>(
    (side, player) => {
      if (state) setZoom(zoomForPlayer(state, side, player, game?.photos ?? {}, user?.id ?? null));
    },
    [state, game?.photos, user?.id],
  );

  if (initial.loading && !game) return <Spinner label="Finding your seat…" />;
  if (initial.error instanceof ApiError && initial.error.status === 403 && !game) {
    return (
      <PasswordGate
        gameId={gameId}
        message={initial.error.message}
        onUnlocked={() => {
          initial.reload();
          setAdmitted((n) => n + 1);
        }}
      />
    );
  }
  if (initial.error && !game) {
    return (
      <EmptyState title="This game would not load">
        <p className="mb-3">{initial.error instanceof Error ? initial.error.message : String(initial.error)}</p>
        <div className="flex justify-center gap-2">
          <Button onClick={() => initial.reload()}>Try again</Button>
          <Link to="/">
            <Button>Back to the lobby</Button>
          </Link>
        </div>
      </EmptyState>
    );
  }
  if (!game) {
    return (
      <EmptyState title="Game not found">
        <Link to="/" className="text-gold underline">
          Back to the lobby
        </Link>
      </EmptyState>
    );
  }

  const waiting = state ? waitingOn(state) : null;

  return (
    <div className="space-y-4">
      <GameHeader game={game} state={state} connected={connected} waiting={waiting} />

      {game.draftId !== null ? (
        <DraftSeriesStrip draftId={game.draftId} currentGameId={gameId} finished={!!finished} iWon={iWonGame} />
      ) : null}

      {game.status === 'open' ? (
        <OpenSeat game={game} onJoined={setGame} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {state ? (
              <>
                {game.status === 'lobby' ? (
                  <LobbyPanel game={game} state={state} mySides={mySides} onAction={runAction} submit={runActionOrThrow} busy={busy} />
                ) : null}

                {state.phase === 'finished' ? <GameOver state={state} earned={earned} userId={user?.id ?? null} /> : null}

                <Panel title="The mat" subtitle={state.phase === 'finished' ? 'Final' : `${state.half === 'top' ? 'Top' : 'Bottom'} ${state.inning} · ${state.outs} out${state.outs === 1 ? '' : 's'}`}>
                  {/* The call on the air: each play unfolds here, one beat at a time. */}
                  <LatestPlay events={events} />
                  <ErrorBoundary label="The field">
                    <Field state={state} photos={game.photos} onZoom={zoomPlayer} />
                  </ErrorBoundary>
                </Panel>

                <Panel title={mySides.length > 0 ? 'Your move' : 'In the stands'} subtitle={waiting && mySides.includes(waiting.side) ? waiting.prompt : undefined}>
                  <ErrorNote error={error} />
                  <ErrorBoundary label="The decision panel">
                    <DecisionControls state={state} mySides={mySides} onAction={dispatchAction} busy={busy} />
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

                {/* Between pitches a manager can reach for the bench — unless
                    a forced decision already owns the moment. */}
                {state.phase === 'live' && !state.pendingDecision && canSubstituteNow(state)
                  ? mySides.map((side) => <BenchPanel key={side} state={state} side={side} onAction={dispatchAction} busy={busy} />)
                  : null}

                <Panel title="Line score">
                  <LineScore state={state} events={events} />
                </Panel>

                {state.phase !== 'lobby' ? (
                  <Panel title="Box score" subtitle="Tap a name to see the card.">
                    <ErrorBoundary label="The box score">
                      <BoxScore state={state} onZoom={zoomPlayer} />
                    </ErrorBoundary>
                  </Panel>
                ) : null}
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
      <CardZoom target={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

/** A password-protected game: give the password once and the room opens for good. */
function PasswordGate({ gameId, message, onUnlocked }: { gameId: number; message: string; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const unlock = useAction(async () => {
    await api.unlockGame(gameId, password);
    onUnlocked();
  });
  return (
    <div className="mx-auto max-w-md space-y-4 pt-8">
      <Panel title="This game has a password" subtitle={message === 'This game is password protected' ? 'The host asked for one. Ask them for it to watch or join.' : message}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock.execute();
          }}
        >
          <input
            type="password"
            name="gamePassword"
            autoFocus
            autoComplete="off"
            className={inputClass}
            placeholder="Game password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <ErrorNote error={unlock.error} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!password || unlock.busy}>
              {unlock.busy ? 'Checking…' : 'Come in'}
            </Button>
            <Link to="/">
              <Button type="button">Back to the lobby</Button>
            </Link>
          </div>
        </form>
      </Panel>
    </div>
  );
}

/**
 * The curtain call: the final line, the packs the win earned, and one obvious
 * way back to the lobby.
 */
function GameOver({ state, earned, userId }: { state: GameState; earned: PackView[]; userId: number | null }) {
  const navigate = useNavigate();
  const winner = state.winner ? state[state.winner] : null;
  const loser = state.winner ? (state.winner === 'home' ? state.away : state.home) : null;
  const mine = winner !== null && winner.userId !== null && winner.userId === userId;
  const sealed = earned.filter((p) => p.openedAt === null);

  return (
    <Panel title="Ballgame!" subtitle={winner && loser ? `${winner.name} defeat ${loser.name}, ${winner.score}–${loser.score}` : undefined}>
      {mine ? (
        sealed.length > 0 ? (
          <p className="text-chalk/75">
            You earned {sealed.length === 1 ? 'a pack' : `${sealed.length} packs`}
            {sealed.length === 1 && sealed[0]?.label ? ` — “${sealed[0].label}”` : ''} for this one.{' '}
            <span className="text-gold">{sealed.length === 1 ? 'It’s' : 'They’re'} sealed on your shelf.</span>
          </p>
        ) : (
          <p className="text-chalk/75">You earned a pack for this one — it’s on your shelf.</p>
        )
      ) : (
        <p className="text-chalk/75">{winner ? 'The other side takes the pack.' : 'Nobody takes it.'}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void navigate('/')}>
          Back to the lobby
        </Button>
        {mine && sealed.length > 0 ? (
          <Button onClick={() => void navigate('/collection')}>Open your packs</Button>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * A scoreboard number: it pops when it changes, the way a real one flips.
 * Keying by the value remounts it on every run.
 */
function Score({ value }: { value: number }) {
  return (
    <motion.span
      key={value}
      initial={{ scale: 1.55 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 16 }}
      className="inline-block font-mono text-2xl font-bold tabular-nums text-gold"
    >
      {value}
    </motion.span>
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
  const capsLabel = matchCapsLabel(game.match);
  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <Link to="/" className="text-sm text-chalk/50 hover:text-chalk">
        ← Lobby
      </Link>

      {state ? (
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-display text-xl font-bold text-chalk">{state.away.name}</span>
          <Score value={state.away.score} />
          <span className="text-chalk/40">at</span>
          <Score value={state.home.score} />
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
        {game.locked ? (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-chalk/60" title="Watching or joining takes the host's password">
            password
          </span>
        ) : null}
        {matchIsOpen(game.match) ? null : (
          <span
            className="rounded-full border border-gold/40 px-2 py-0.5 text-gold"
            title={`Cards: ${matchEraLabel(game.match)}${capsLabel ? `, ${capsLabel}` : ''}`}
          >
            {game.match.yearFrom <= MATCH_LIMITS.minYear && game.match.yearTo >= MATCH_LIMITS.maxYear
              ? (capsLabel ?? matchEraLabel(game.match))
              : matchEraLabel(game.match)}
          </span>
        )}
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
  submit,
  busy,
}: {
  game: GameRoom;
  state: GameState;
  mySides: Side[];
  onAction: (action: GameAction) => Promise<void>;
  /** sends an action and rethrows on failure, for the lineup editor's own errors */
  submit: (action: GameAction) => Promise<void>;
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

      {mySides.map((side) => (
        <LobbyLineupEditor
          key={side}
          state={state}
          side={side}
          submit={submit}
          outOfPosition={state.config.match?.outOfPosition === true}
        />
      ))}

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
  const navigate = useNavigate();
  const teams = useLoad(() => api.teams(), []);
  const [teamId, setTeamId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const isMine = game.hostUserId === user?.id;
  const myTeams: TeamSummary[] = teams.data?.teams ?? [];

  const cancel = useAction(async () => {
    await api.deleteGame(game.id);
    navigate('/');
  });

  if (isMine) {
    return (
      <Panel title="Your game is posted" subtitle="It is listed in the lobby with an open seat.">
        <p className="text-sm text-chalk/60">
          Send your friend to the Lobby and they can join with one of their teams. The dice decide who is home once both of you press play.
        </p>
        <ErrorNote error={cancel.error} />
        <div className="mt-4 flex gap-2">
          <Link to="/">
            <Button>Back to the lobby</Button>
          </Link>
          <Button variant="danger" disabled={cancel.busy} onClick={() => void cancel.execute()}>
            {cancel.busy ? 'Taking it down…' : 'Take this game down'}
          </Button>
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

// ---------------------------------------------------------------------------
// The lobby lineup editor
// ---------------------------------------------------------------------------

/** The lineup as the engine currently holds it, keyed the way set-lineup wants. */
function lineupFromTeam(team: TeamState): SavedLineup {
  const fieldPositions: SavedLineup['fieldPositions'] = {};
  for (const p of team.players) {
    if (p.status === 'active' && p.fieldPosition && p.fieldPosition !== 'DH') fieldPositions[p.fieldPosition] = p.id;
  }
  return {
    lineup: team.lineup.filter((id): id is string => id !== null),
    fieldPositions,
    startingPitcherId: team.activePitcherId ?? '',
  };
}

/** A cheap fingerprint of the engine's lineup, to resync the editor when it changes. */
function lineupSignature(team: TeamState): string {
  const positions = team.players
    .filter((p) => p.status === 'active' && p.fieldPosition)
    .map((p) => `${p.id}:${p.fieldPosition}`)
    .sort()
    .join(',');
  return `${team.lineup.join(',')}|${positions}|${team.activePitcherId ?? ''}`;
}

function lineupCandidates(team: TeamState): LineupCandidate[] {
  return team.players.map((p) => ({
    id: p.id,
    name: p.name,
    cardYear: p.cardYear,
    positions: p.positions,
    pitcherClass: p.pitcherClass,
    // The engine lets anyone with an eligible position bat; a pure pitcher has none.
    canBat: p.positions.length > 0,
  }));
}

/**
 * Set your nine before the first pitch. Only the sides the viewer manages are
 * editable — in hotseat that is both. The engine rejects set-lineup once the
 * game is live, so this lives only in the lobby.
 */
function LobbyLineupEditor({
  state,
  side,
  submit,
  outOfPosition,
}: {
  state: GameState;
  side: Side;
  submit: (action: GameAction) => Promise<void>;
  outOfPosition: boolean;
}) {
  const team = state[side];
  const signature = lineupSignature(team);
  const [draft, setDraft] = useState<SavedLineup>(() => lineupFromTeam(team));
  const [dirty, setDirty] = useState(false);

  // The engine's lineup can change under us (a save, the other manager). Resync
  // only while the manager has nothing unsaved, so their edits are not clobbered.
  useEffect(() => {
    if (!dirty) setDraft(lineupFromTeam(team));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const candidates = useMemo(() => lineupCandidates(team), [team]);
  const problem = lineupProblem(candidates, draft);

  const save = useAction(async () => {
    await submit({
      type: 'set-lineup',
      side,
      lineup: draft.lineup,
      fieldPositions: draft.fieldPositions,
      startingPitcherId: draft.startingPitcherId,
    });
    setDirty(false);
  });

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-semibold text-chalk">Set your lineup · {team.name}</h3>
          <p className="text-xs text-chalk/50">Eight fielders, a designated hitter, and a starting pitcher. The pitcher does not bat.</p>
        </div>
        <Button variant="primary" size="sm" disabled={save.busy || !dirty || !!problem} onClick={() => void save.execute()}>
          {save.busy ? 'Saving…' : dirty ? 'Save lineup' : 'Saved'}
        </Button>
      </div>
      <LineupBuilder
        candidates={candidates}
        value={draft}
        outOfPosition={outOfPosition}
        onChange={(next) => {
          setDraft(next);
          setDirty(true);
        }}
      />
      {problem ? <p className="mt-3 text-sm text-chalk/50">{problem}</p> : null}
      <ErrorNote error={save.error} />
    </div>
  );
}

/**
 * The draft series, on the game page: where this game sits in the set, and the
 * two ways out of it once it is over. The pack and keep-card decisions live in
 * the draft room.
 */
function DraftSeriesStrip({
  draftId,
  currentGameId,
  finished,
  iWon,
}: {
  draftId: number;
  currentGameId: number;
  finished: boolean;
  iWon: boolean;
}) {
  const navigate = useNavigate();
  const room = useLoad(() => api.draft(draftId), [draftId]);
  const rematch = useAction(async () => {
    const { gameId } = await api.rematchDraft(draftId);
    navigate(`/games/${gameId}`);
  });
  const draft: DraftView | null = room.data?.draft ?? null;
  if (!draft) return null;

  const nameFor = (seat: number) => draft.seats.find((s) => s.seat === seat)?.name ?? `Seat ${seat + 1}`;

  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <span className="text-[10px] font-semibold tracking-wide text-gold uppercase">Draft series</span>
      {draft.games.length === 0 ? (
        <span className="text-xs text-chalk/50">Game one is under way.</span>
      ) : (
        <ol className="flex flex-wrap gap-2">
          {draft.games.map((g) => (
            <li
              key={g.gameId}
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${
                g.gameId === currentGameId ? 'border-gold/60 text-gold' : 'border-white/15 text-chalk/70'
              }`}
            >
              {nameFor(g.awaySeat)} {g.awayScore}–{g.homeScore} {nameFor(g.homeSeat)}
              {g.winnerSeat !== null ? ` · ${nameFor(g.winnerSeat)} won` : ' · in progress'}
            </li>
          ))}
        </ol>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {finished && iWon ? <span className="text-xs text-gold">Pick your bonus pack in the draft room →</span> : null}
        {finished ? (
          <>
            <Button size="sm" disabled={rematch.busy} onClick={() => void rematch.execute()}>
              {rematch.busy ? 'Dealing…' : 'Rematch'}
            </Button>
            <Button size="sm" onClick={() => void navigate(`/drafts/${draftId}`)}>
              Back to the draft room
            </Button>
          </>
        ) : null}
      </div>
      <ErrorNote error={room.error ?? rematch.error} />
    </div>
  );
}

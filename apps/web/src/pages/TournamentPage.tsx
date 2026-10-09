import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { formatLabel, recordLabel, tournamentEraLabel } from '@cardball/shared';
import type { MatchSlot, TournamentMatch, TournamentView } from '@cardball/shared';
import { api } from '../api.js';
import { Button, ConfirmDialog, EmptyState, ErrorNote, Notice, Panel, Spinner, useAction, useLoad } from '../components/ui.js';
import { useSession } from '../session.js';

const STATUS_LABEL: Record<TournamentView['status'], string> = {
  lobby: 'Taking seats',
  drafting: 'Drafting',
  playing: 'In play',
  finished: 'Finished',
};

/**
 * The draft's rarity caps as the room prints them. Configs saved before the
 * mythic tier may lack star and mythic counts; those read as no cap there.
 */
function draftCapsLabel(caps: { rare: number; star: number; mythic: number } | null): string {
  const star = caps?.star ?? 0;
  const mythic = caps?.mythic ?? 0;
  return `${caps?.rare ?? 0} rare/${star} star/${mythic} mythic cap`;
}

export function TournamentPage() {
  const id = Number(useParams().id);
  const { user } = useSession();
  const navigate = useNavigate();
  const room = useLoad(() => api.tournament(id), [id]);

  const start = useAction(async () => {
    await api.startTournament(id);
    room.reload();
  });
  const join = useAction(async () => {
    await api.joinTournament(id);
    room.reload();
  });
  const simulate = useAction(async () => {
    await api.simulateTournament(id);
    room.reload();
  });
  const close = useAction(async () => {
    await api.deleteTournament(id);
    navigate('/tournaments');
  });
  const [askClose, setAskClose] = useState(false);
  const [simulation, setSimulation] = useState<{ current: number; total: number; stage?: string; done?: boolean } | null>(null);

  // Live updates: the tournament room nudges, and while the draft is running so
  // does the draft room, so picks move the schedule along.
  useEffect(() => {
    const socket: Socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('connect', () => socket.emit('tournament:join', id, () => void room.reload()));
    socket.on('tournament:update', () => void room.reload());
    socket.on('tournament:progress', (progress: { current: number; total: number; stage?: string; done?: boolean }) => setSimulation(progress));
    return () => {
      socket.emit('tournament:leave', id);
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const draftId = room.data?.tournament.draftId;
    const drafting = room.data?.tournament.status === 'drafting';
    if (!draftId || !drafting) return;
    const socket: Socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('connect', () => socket.emit('draft:join', draftId, () => void room.reload()));
    socket.on('draft:update', () => void room.reload());
    return () => {
      socket.emit('draft:leave', draftId);
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, room.data?.tournament.draftId, room.data?.tournament.status]);

  if (room.loading && !room.data) return <Spinner label="Finding the room…" />;
  if (room.error) {
    return (
      <Panel title="Tournament">
        <ErrorNote error={room.error} />
      </Panel>
    );
  }
  const t = room.data!.tournament;
  const isHost = user?.id === t.hostUserId;
  const mySeat = t.seats.find((s) => s.userId === user?.id) ?? null;
  const seatsFilled = t.seats.filter((s) => s.userId !== 0).length;
  const champion = t.championSeat !== null ? t.seats[t.championSeat] : null;

  const seatName = (seat: number) => t.seats[seat]?.name ?? `Seat ${seat + 1}`;
  const stageOf = (matchId: string) => t.matches.find((m) => m.id === matchId)?.stage ?? matchId;
  const slotLabel = (slot: MatchSlot) =>
    'seed' in slot ? seatName(slot.seed) : 'winnerOf' in slot ? `winner of the ${stageOf(slot.winnerOf)}` : `loser of the ${stageOf(slot.loserOf)}`;

  const matchLine = (match: TournamentMatch) => {
    if (match.winnerSeat !== null) {
      const score = t.scores[match.id];
      const hi = score ? Math.max(score.home, score.away) : null;
      const lo = score ? Math.min(score.home, score.away) : null;
      return (
        <span className="text-sm text-chalk">
          <span className="font-semibold text-gold">{seatName(match.winnerSeat)}</span> beat{' '}
          {seatName(match.loserSeat!)}
          {match.forfeit ? (
            <span className="ml-1 text-chalk/60" title={match.error ?? undefined}>
              by forfeit
            </span>
          ) : hi !== null && lo !== null ? (
            <span className="ml-1 font-mono text-chalk/70"> {hi}–{lo}</span>
          ) : null}
        </span>
      );
    }
    if (match.error !== null) return <span className="text-sm text-crimson">{match.error}</span>;
    if (match.gameId !== null) {
      return (
        <Link to={`/games/${match.gameId}`} className="text-sm text-gold hover:underline">
          {seatName(match.homeSeat!)} vs. {seatName(match.awaySeat!)} — open the game
        </Link>
      );
    }
    return (
      <span className="text-sm text-chalk/50">
        {slotLabel(match.home)} vs. {slotLabel(match.away)} — waiting on earlier results
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-bold text-chalk">{t.name}</h1>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                t.status === 'playing' ? 'bg-crimson/25 text-crimson' : t.status === 'finished' ? 'bg-white/10 text-chalk/60' : 'bg-gold/20 text-gold'
              }`}
            >
              {STATUS_LABEL[t.status]}
            </span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-chalk/60">
            <span>{formatLabel(t.config.format)}</span>
            <span>·</span>
            <span>{tournamentEraLabel(t.config.draft)} cards</span>
            <span>·</span>
            <span>
              {t.config.draft.rounds} × {t.config.draft.packSize} packs each
            </span>
            {t.config.draft.rarityCaps ? (
              <>
                <span>·</span>
                <span>{draftCapsLabel(t.config.draft.rarityCaps)}</span>
              </>
            ) : null}
            <span>·</span>
            <span>{t.config.regulationInnings} innings</span>
            <span>·</span>
            <span>{t.config.autoSimulate ? 'played out automatically' : 'played live'}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isHost && t.status === 'lobby' ? (
            <Button size="sm" variant="primary" disabled={start.busy || seatsFilled < t.config.seats} onClick={() => void start.execute()}>
              {start.busy ? 'Dealing…' : 'Deal the packs'}
            </Button>
          ) : null}
          {!isHost && t.status === 'lobby' && !mySeat ? (
            <Button size="sm" variant="primary" disabled={join.busy || seatsFilled >= t.config.seats} onClick={() => void join.execute()}>
              Take a seat
            </Button>
          ) : null}
          {isHost && t.status === 'playing' ? (
            <Button size="sm" disabled={simulate.busy} onClick={() => void simulate.execute()}>
              {simulate.busy ? 'Playing…' : 'Play out the rest'}
            </Button>
          ) : null}
          {isHost && t.status !== 'finished' ? (
            <Button size="sm" variant="danger" disabled={close.busy} onClick={() => setAskClose(true)}>
              Close the room
            </Button>
          ) : null}
        </div>
      </section>

      {simulation && !simulation.done ? (
        <div className="rounded-xl border border-gold/25 bg-black/20 px-4 py-3" role="status" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm text-chalk/80">
            <span>Simulating match {simulation.current} of {simulation.total}{simulation.stage ? ` · ${simulation.stage}` : ''}</span>
            <span className="font-mono text-xs text-chalk/55">{Math.round((simulation.current / simulation.total) * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gold transition-[width] duration-300"
              style={{ width: `${Math.round((simulation.current / simulation.total) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={askClose}
        title="Close the tournament?"
        danger
        busy={close.busy}
        confirmLabel="Close the room"
        onConfirm={() => {
          setAskClose(false);
          void close.execute();
        }}
        onCancel={() => setAskClose(false)}
      >
        <p>The draft room goes with it; games already played stay.</p>
      </ConfirmDialog>

      <ErrorNote error={room.error} />
      <ErrorNote error={start.error} />
      <ErrorNote error={join.error} />
      <ErrorNote error={simulate.error} />
      <ErrorNote error={close.error} />

      {champion && t.status === 'finished' ? <Notice>{champion.name} wins the tournament.</Notice> : null}

      {t.status === 'drafting' && t.draftId !== null ? (
        <Panel title="The draft is running" subtitle="The tournament schedule is set as soon as the last pack runs out.">
          <Link to={`/drafts/${t.draftId}`}>
            <Button variant="primary">Open the draft room</Button>
          </Link>
          <p className="mt-3 text-sm text-chalk/60">
            Every card you take goes into your collection, and your tournament team is exactly the cards you drafted — so take
            enough to field nine.
          </p>
        </Panel>
      ) : null}

      <div className={`grid gap-6 ${t.status === 'lobby' ? 'lg:grid-cols-2' : 'lg:grid-cols-[1.5fr_1fr]'}`}>
        <Panel
          title={t.status === 'lobby' ? 'Seats' : 'Standings'}
          subtitle={
            t.status === 'lobby'
              ? `${seatsFilled} of ${t.config.seats} seats taken${isHost ? ' — deal the packs when everyone is in' : ''}`
              : 'Records and runs from the matches played out so far.'
          }
        >
          {t.status === 'lobby' ? (
            <ul className="space-y-2">
              {t.seats.map((s) => (
                <li key={s.seat} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                  <span className="font-mono text-xs text-chalk/50">Seat {s.seat + 1}</span>
                  <span className="font-medium text-chalk">{s.name}</span>
                  {s.isHost ? <span className="text-[10px] tracking-wide text-gold uppercase">host</span> : null}
                </li>
              ))}
              {seatsFilled < t.config.seats ? <li className="text-sm text-chalk/50">{t.config.seats - seatsFilled} seat(s) still open.</li> : null}
            </ul>
          ) : t.seats.every((s) => s.userId === 0) ? (
            <EmptyState title="No managers seated">The draft room is missing its seats.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs tracking-wide text-chalk/50 uppercase">
                  <th className="pb-2 pr-3 font-semibold">Manager</th>
                  <th className="pb-2 pr-3 font-semibold">Tournament team</th>
                  <th className="pb-2 pr-3 font-semibold">Record</th>
                  <th className="pb-2 font-semibold">Runs</th>
                </tr>
              </thead>
              <tbody>
                {t.seats.map((s) => (
                  <tr
                    key={s.seat}
                    className={`border-t border-white/10 ${t.championSeat === s.seat ? 'bg-gold/10' : ''}`}
                  >
                    <td className="py-2 pr-3 text-chalk">
                      {s.isHost ? <span className="mr-1 text-[10px] tracking-wide text-gold uppercase">host</span> : null}
                      {s.name}
                    </td>
                    <td className="py-2 pr-3">
                      {s.teamId ? (
                        <Link to={`/teams/${s.teamId}`} className="text-chalk/80 hover:text-gold hover:underline">
                          {s.teamName}
                        </Link>
                      ) : (
                        <span className="text-chalk/40">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-chalk/80">{recordLabel(s)}</td>
                    <td className="py-2 font-mono text-chalk/60">
                      {s.runsFor}–{s.runsAgainst}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {t.status === 'lobby' ? (
          <Panel title="How it runs">
            <ul className="list-disc space-y-2 pl-5 text-sm text-chalk/70">
              <li>Every manager drafts from the same packs — {t.config.draft.rounds} packs of {t.config.draft.packSize}, one card at a time, passing along.</li>
              <li>Your tournament team is exactly the cards you draft. Nothing else plays.</li>
              <li>{formatLabel(t.config.format)}.</li>
              <li>
                Matches are ordinary games: {t.config.regulationInnings} innings,{' '}
                {t.config.autoSimulate ? 'played out by the server as they are scheduled' : 'played live by the managers'}.
              </li>
            </ul>
          </Panel>
        ) : (
          <Panel title="The log">
            <ul className="max-h-80 space-y-1.5 overflow-y-auto font-mono text-xs leading-relaxed text-chalk/70">
              {t.log.map((line) => (
                <li key={line.seq}>{line.text}</li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      {t.status !== 'lobby' ? (
        <Panel
          title="The schedule"
          subtitle={
            t.config.format === 'semis'
              ? 'Semifinals, a final, and a third place game. Slots fill in as the earlier games finish.'
              : 'Everyone plays everyone once.'
          }
        >
          <ul className="space-y-2">
            {t.matches.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5"
              >
                <span className="w-28 shrink-0 text-xs font-semibold tracking-wide text-chalk/60 uppercase">{m.stage}</span>
                {matchLine(m)}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

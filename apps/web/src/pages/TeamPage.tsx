import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { OUT_OF_POSITION_RATING } from '@cardball/engine';
import { faceLabel, rateCard } from '@cardball/shared';
import type { CollectionCard, RosterEntryView, SavedLineup, TeamView } from '@cardball/shared';
import { api } from '../api.js';
import { ZoomableCard } from '../components/CardZoom.js';
import { RarityBadge } from '../components/RarityBadge.js';
import { Button, EmptyState, ErrorNote, Field, Panel, Spinner, inputClass, useAction, useLoad } from '../components/ui.js';

const FIELD: readonly { pos: string; label: string }[] = [
  { pos: 'C', label: 'Catcher' },
  { pos: '1B', label: 'First base' },
  { pos: '2B', label: 'Second base' },
  { pos: '3B', label: 'Third base' },
  { pos: 'SS', label: 'Shortstop' },
  { pos: 'LF', label: 'Left field' },
  { pos: 'CF', label: 'Center field' },
  { pos: 'RF', label: 'Right field' },
];

export function TeamPage() {
  const teamId = Number(useParams().id);
  const team = useLoad(() => api.team(teamId), [teamId]);
  const collection = useLoad(() => api.collection(), []);
  const [view, setView] = useState<TeamView | null>(null);

  useEffect(() => {
    if (team.data?.team) setView(team.data.team);
  }, [team.data]);

  const roster = view?.roster ?? [];
  const rosterIds = new Set(roster.map((r) => r.id));
  const available = (collection.data?.cards ?? []).filter((c) => !rosterIds.has(c.id));
  const ratings = useMemo(() => new Map(roster.map((r) => [r.id, rateCard(r.card)])), [roster]);

  const setRoster = useAction(async (ids: number[]) => {
    const { team: updated } = await api.setRoster(teamId, ids);
    setView(updated);
  });

  const auto = useAction(async () => {
    const { team: updated } = await api.autoLineup(teamId);
    setView(updated);
  });

  const remove = useAction(async () => {
    await api.deleteTeam(teamId);
    window.location.assign('/teams');
  });

  if (team.loading && !view) return <Spinner label="Fetching the team…" />;
  if (team.error) return <ErrorNote error={team.error} />;
  if (!view) return <EmptyState title="Team not found" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-8 w-8 rounded-full ring-2 ring-white/20" style={{ background: view.primaryColor ?? '#4b5563' }} />
          <div>
            <h1 className="font-display text-3xl font-bold text-chalk">{view.name}</h1>
            <p className="mt-1 text-sm text-chalk/60">
              {roster.length} cards ·{' '}
              {view.lineupProblem ? <span className="text-crimson">{view.lineupProblem}</span> : <span className="text-gold">lineup is legal</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void auto.execute()} disabled={auto.busy || roster.length === 0}>
            {auto.busy ? 'Picking…' : 'Auto-fill lineup'}
          </Button>
          <Link to="/">
            <Button variant="primary">Play a game</Button>
          </Link>
          <Button
            variant="danger"
            disabled={remove.busy}
            onClick={() => {
              if (confirm(`Delete ${view.name}? Your cards stay in your collection.`)) void remove.execute();
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      <ErrorNote error={setRoster.error ?? auto.error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Roster" subtitle={`${roster.length} of 26 cards.`}>
          {roster.length === 0 ? (
            <EmptyState title="No cards on this team">Add cards from your collection below.</EmptyState>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {roster.map((entry) => (
                  <div key={entry.teamCardId}>
                    <ZoomableCard
                      target={{
                        card: entry.card,
                        photoId: entry.photoId,
                        rarity: faceLabel(ratings.get(entry.id)?.rarity ?? 'common'),
                        tier: ratings.get(entry.id)?.rarity ?? 'common',
                        userCardId: entry.id,
                      }}
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <span className="truncate text-xs text-chalk/55">{entry.card.name}</span>
                      <Button size="sm" variant="ghost" onClick={() => void setRoster.execute(roster.filter((r) => r.id !== entry.id).map((r) => r.id))}>
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Add from your collection" subtitle={`${available.length} cards not on this team.`}>
          {available.length === 0 ? (
            <EmptyState title="Nothing left to add">
              <Link className="text-gold underline" to="/search">
                Find more cards
              </Link>
            </EmptyState>
          ) : (
            <ul className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
              {available.map((card) => {
                const rating = rateCard(card.card);
                return (
                  <li key={card.id}>
                    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-chalk">
                          {card.card.name} <span className="font-mono text-xs text-chalk/50">{card.card.cardYear}</span>
                          <RarityBadge rarity={rating.rarity} />
                        </p>
                        <p className="truncate font-mono text-xs text-chalk/45">
                          {card.card.positions.join(' ')}
                          {card.card.pitcherClass ? ` · ${card.card.pitcherClass}` : ''}
                          {card.card.playable ? '' : ' · not game-legal'}
                        </p>
                        <p className="truncate font-mono text-[11px] text-chalk/40">{rating.headline}</p>
                      </div>
                      <Button
                        size="sm"
                        disabled={setRoster.busy || roster.length >= 26}
                        onClick={() => void setRoster.execute([...roster.map((r) => r.id), card.id])}
                      >
                        Add
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <LineupEditor
        team={view}
        onSaved={setView}
      />
    </div>
  );
}

function LineupEditor({ team, onSaved }: { team: TeamView; onSaved: (team: TeamView) => void }) {
  const [lineup, setLineup] = useState<SavedLineup | null>(team.lineup);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLineup(team.lineup);
    setDirty(false);
  }, [team]);

  const hitters = useMemo(() => team.roster.filter((r) => r.card.playable && r.card.canBat), [team.roster]);
  const pitchers = useMemo(() => team.roster.filter((r) => r.card.pitcherClass === 'SP'), [team.roster]);

  const current: SavedLineup = lineup ?? { lineup: [], fieldPositions: {}, startingPitcherId: '' };

  const setField = (pos: string, id: string) => {
    const fieldPositions = { ...current.fieldPositions };
    if (id) fieldPositions[pos as keyof typeof fieldPositions] = id;
    else delete fieldPositions[pos as keyof typeof fieldPositions];
    setLineup({ ...current, fieldPositions });
    setDirty(true);
  };

  const assigned = new Set(Object.values(current.fieldPositions).filter(Boolean) as string[]);
  const dh = current.lineup.find((id) => !assigned.has(id)) ?? '';

  const setDh = (id: string) => {
    const fielders = Object.values(current.fieldPositions).filter(Boolean) as string[];
    setLineup({ ...current, lineup: id ? [...fielders, id] : fielders });
    setDirty(true);
  };

  const problem = useMemo(() => {
    const missing = FIELD.filter((f) => !current.fieldPositions[f.pos as keyof typeof current.fieldPositions]);
    if (missing.length) return `Assign ${missing.map((m) => m.pos).join(', ')}.`;
    if (!dh) return 'Pick a designated hitter.';
    if (!current.startingPitcherId) return 'Pick a starting pitcher.';
    return null;
  }, [current, dh]);

  const save = useAction(async () => {
    if (problem) return;
    const { team: updated } = await api.updateTeam(team.id, { lineup: current });
    onSaved(updated);
    setDirty(false);
  });

  const playerLabel = (entry: RosterEntryView) => `${entry.card.name} (${entry.card.cardYear})`;

  return (
    <Panel
      title="Lineup"
      subtitle="Eight fielders, a designated hitter, and a starting pitcher. The pitcher does not bat."
      actions={
        <>
          <Button onClick={() => void save.execute()} variant="primary" disabled={save.busy || !dirty || !!problem}>
            {save.busy ? 'Saving…' : dirty ? 'Save lineup' : 'Saved'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELD.map(({ pos, label }) => {
          const eligible = hitters.filter((r) => r.card.positions.includes(pos as never));
          const offCard = team.outOfPosition ? hitters.filter((r) => !r.card.positions.includes(pos as never)) : [];
          const value = (current.fieldPositions[pos as keyof typeof current.fieldPositions] as string | undefined) ?? '';
          return (
            <Field key={pos} label={`${pos} · ${label}`}>
              <select className={inputClass} value={value} onChange={(e) => setField(pos, e.target.value)}>
                <option value="">— nobody —</option>
                {eligible.map((r) => (
                  <option key={r.id} value={String(r.teamCardId)}>
                    {playerLabel(r)}
                  </option>
                ))}
                {offCard.length ? (
                  <optgroup label={`Out of position (fielding ${OUT_OF_POSITION_RATING})`}>
                    {offCard.map((r) => (
                      <option key={r.id} value={String(r.teamCardId)}>
                        {playerLabel(r)}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </Field>
          );
        })}

        <Field label="DH · Designated hitter">
          <select className={inputClass} value={dh} onChange={(e) => setDh(e.target.value)}>
            <option value="">— nobody —</option>
            {hitters
              .filter((r) => !assigned.has(String(r.teamCardId)))
              .map((r) => (
                <option key={r.id} value={String(r.teamCardId)}>
                  {playerLabel(r)}
                </option>
              ))}
          </select>
        </Field>

        <Field label="SP · Starting pitcher">
          <select className={inputClass} value={current.startingPitcherId} onChange={(e) => setLineup({ ...current, startingPitcherId: e.target.value })}>
            <option value="">— nobody —</option>
            {pitchers.map((r) => (
              <option key={r.id} value={String(r.teamCardId)}>
                {playerLabel(r)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {problem ? <p className="mt-3 text-sm text-chalk/50">{problem}</p> : null}
      <ErrorNote error={save.error} />
      <ErrorNote error={team.lineupProblem ? new Error(team.lineupProblem) : null} />
    </Panel>
  );
}

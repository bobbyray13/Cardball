import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { OUT_OF_POSITION_RATING } from '@cardball/engine';
import { RARITY_LABEL, RARITY_ORDER, faceLabel, rarityRank, rateCard } from '@cardball/shared';
import type { CollectionCard, DraftRarity, Position, RosterEntryView, SavedLineup, TeamView } from '@cardball/shared';
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

/** The batting lineup's spots, in the order a scorecard lists them. */
const LINEUP_SPOTS: readonly Position[] = [...FIELD.map((f) => f.pos as Position), 'DH'];

/** The eight spots a legal lineup must cover, plus the DH and the mound. */
const CHECKLIST: readonly { key: string; label: string }[] = [
  ...LINEUP_SPOTS.map((pos) => ({ key: pos, label: pos })),
  { key: 'SP', label: 'SP' },
  { key: 'RP', label: 'RP' },
];

type SortKey = 'position' | 'rarity' | 'name' | 'team' | 'year-desc' | 'year-asc';
/** 'P' is every card that can pitch, whatever position it also fields. */
type PositionFilter = 'all' | 'P' | Position;

const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: 'position', label: 'Position' },
  { key: 'rarity', label: 'Rarest first' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'team', label: 'Team A–Z' },
  { key: 'year-desc', label: 'Card year, newest' },
  { key: 'year-asc', label: 'Card year, oldest' },
];

export function TeamPage() {
  const teamId = Number(useParams().id);
  const navigate = useNavigate();
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

  // ---- Picking from the collection ----
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('all');
  const [rarityFilter, setRarityFilter] = useState<DraftRarity | 'all'>('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [yearFrom, setYearFrom] = useState(0);
  const [yearTo, setYearTo] = useState(0);
  const [sort, setSort] = useState<SortKey>('position');

  const years = useMemo(() => [...new Set(available.map((c) => c.card.cardYear))].sort((a, b) => a - b), [available]);
  const teams = useMemo(() => [...new Set(available.map((c) => c.card.teamLabel).filter((t) => t !== ''))].sort((a, b) => a.localeCompare(b)), [available]);
  // 0 means "no bound chosen yet": the picker opens showing the whole collection.
  const fromYear = yearFrom === 0 ? (years[0] ?? 0) : yearFrom;
  const toYear = yearTo === 0 ? (years[years.length - 1] ?? 0) : yearTo;

  const picked = useMemo(() => {
    const list = available.filter((c) => {
      if (positionFilter === 'P') {
        if (c.card.pitcherClass === null) return false;
      } else if (positionFilter !== 'all' && !c.card.positions.includes(positionFilter)) {
        return false;
      }
      if (rarityFilter !== 'all' && rateCard(c.card).rarity !== rarityFilter) return false;
      if (teamFilter !== 'all' && c.card.teamLabel !== teamFilter) return false;
      return c.card.cardYear >= fromYear && c.card.cardYear <= toYear;
    });

    const spot = (c: CollectionCard) => {
      const at = LINEUP_SPOTS.indexOf(c.card.positions[0] ?? 'DH');
      return at === -1 ? LINEUP_SPOTS.length : at;
    };
    const byRarity = (a: CollectionCard, b: CollectionCard) => rarityRank(rateCard(b.card).rarity) - rarityRank(rateCard(a.card).rarity);
    const compare: Record<SortKey, (a: CollectionCard, b: CollectionCard) => number> = {
      position: (a, b) => spot(a) - spot(b) || a.card.name.localeCompare(b.card.name),
      rarity: byRarity,
      name: (a, b) => a.card.name.localeCompare(b.card.name),
      team: (a, b) => a.card.teamLabel.localeCompare(b.card.teamLabel) || a.card.name.localeCompare(b.card.name),
      'year-desc': (a, b) => b.card.cardYear - a.card.cardYear || a.card.name.localeCompare(b.card.name),
      'year-asc': (a, b) => a.card.cardYear - b.card.cardYear || a.card.name.localeCompare(b.card.name),
    };
    return [...list].sort(compare[sort]);
  }, [available, positionFilter, rarityFilter, teamFilter, fromYear, toYear, sort]);

  const filtering = positionFilter !== 'all' || rarityFilter !== 'all' || teamFilter !== 'all' || fromYear !== (years[0] ?? 0) || toYear !== (years[years.length - 1] ?? 0);

  const clearFilters = () => {
    setPositionFilter('all');
    setRarityFilter('all');
    setTeamFilter('all');
    setYearFrom(0);
    setYearTo(0);
  };

  // How many roster cards can cover each spot. A card counts for every position
  // it is eligible for, so a shortstop who also plays second counts at both.
  const coverage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of roster) {
      for (const pos of entry.card.positions) counts.set(pos, (counts.get(pos) ?? 0) + 1);
      if (entry.card.pitcherClass) counts.set(entry.card.pitcherClass, (counts.get(entry.card.pitcherClass) ?? 0) + 1);
    }
    return counts;
  }, [roster]);

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
    navigate('/teams');
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
          <PositionChecklist coverage={coverage} rosterSize={roster.length} />
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

        <Panel
          title="Add from your collection"
          subtitle={`${picked.length} of ${available.length} cards${filtering ? ' match your filters' : ' not on this team'}.`}
          actions={
            filtering ? (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null
          }
        >
          {available.length === 0 ? (
            <EmptyState title="Nothing left to add">
              <Link className="text-gold underline" to="/search">
                Find more cards
              </Link>
            </EmptyState>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="Position">
                  <select className={inputClass} value={positionFilter} onChange={(e) => setPositionFilter(e.target.value as PositionFilter)}>
                    <option value="all">Any position</option>
                    {LINEUP_SPOTS.map((pos) => (
                      <option key={pos} value={pos}>
                        {pos === 'DH' ? 'DH · designated hitter' : pos}
                      </option>
                    ))}
                    <option value="P">P · can pitch</option>
                  </select>
                </Field>
                <Field label="Rarity">
                  <select className={inputClass} value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value as DraftRarity | 'all')}>
                    <option value="all">Any rarity</option>
                    {[...RARITY_ORDER].reverse().map((tier) => (
                      <option key={tier} value={tier}>
                        {RARITY_LABEL[tier]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Team">
                  <select className={inputClass} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                    <option value="all">Any team</option>
                    {teams.map((team) => (
                      <option key={team} value={team}>
                        {team}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Era · from">
                  <select
                    className={inputClass}
                    value={fromYear}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setYearFrom(next);
                      if (next > toYear) setYearTo(next);
                    }}
                  >
                    {years.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Era · to">
                  <select
                    className={inputClass}
                    value={toYear}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setYearTo(next);
                      if (next < fromYear) setYearFrom(next);
                    }}
                  >
                    {years.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sort by">
                  <select className={inputClass} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                    {SORTS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {picked.length === 0 ? (
                <EmptyState title="No cards match those filters">
                  <button type="button" className="text-gold underline" onClick={clearFilters}>
                    Clear the filters
                  </button>
                </EmptyState>
              ) : (
                <ul className="max-h-[32rem] space-y-1.5 overflow-y-auto pr-1">
                  {picked.map((card) => {
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
                              {card.card.teamLabel ? `${card.card.teamLabel} · ` : ''}
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
            </>
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

/**
 * How many cards on the roster can cover each spot. A card counts for every
 * position it is eligible for — a shortstop who also plays second base counts
 * at both — so a manager can see at a glance what is still missing.
 */
function PositionChecklist({ coverage, rosterSize }: { coverage: Map<string, number>; rosterSize: number }) {
  if (rosterSize === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="mb-2 text-xs font-semibold tracking-wide text-chalk/50 uppercase">Position coverage</p>
      <div className="flex flex-wrap gap-1.5">
        {CHECKLIST.map(({ key, label }) => {
          const count = coverage.get(key) ?? 0;
          // A legal lineup needs the eight field spots, a DH, and a starter.
          const missing = count === 0 && key !== 'RP';
          return (
            <span
              key={key}
              title={`${count} card${count === 1 ? '' : 's'} can play ${label}`}
              className={`rounded-full border px-2.5 py-1 font-mono text-xs ${
                missing ? 'border-crimson/60 text-crimson' : 'border-white/15 text-chalk/80'
              }`}
            >
              {label} {count}
            </span>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-chalk/45">
        A card counts towards every position it is eligible for. A legal lineup needs all eight field spots, a designated hitter, and a
        starting pitcher.
      </p>
    </div>
  );
}

/** The nine hitters as they bat, with the DH last. Empty when nothing is set. */
const EMPTY_LINEUP: SavedLineup = { lineup: [], fieldPositions: {}, startingPitcherId: '' };

/**
 * Keep the batting order a permutation of exactly the eight fielders plus the
 * designated hitter. Cards already in the order keep their place; a card that
 * has just been given a spot is appended, so a manager can assign positions
 * first and then drag the order into shape.
 */
function withMembers(order: string[], fieldPositions: SavedLineup['fieldPositions'], dhId: string): string[] {
  const members = new Set([...(Object.values(fieldPositions).filter(Boolean) as string[]), dhId].filter((id) => id !== ''));
  const kept = order.filter((id) => members.has(id));
  const added = [...members].filter((id) => !kept.includes(id));
  return [...kept, ...added];
}

function LineupEditor({ team, onSaved }: { team: TeamView; onSaved: (team: TeamView) => void }) {
  const [draft, setDraft] = useState<SavedLineup | null>(team.lineup);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(team.lineup);
    setDirty(false);
  }, [team]);

  const hitters = useMemo(() => team.roster.filter((r) => r.card.playable && r.card.canBat), [team.roster]);
  const pitchers = useMemo(() => team.roster.filter((r) => r.card.pitcherClass === 'SP'), [team.roster]);

  const current = draft ?? EMPTY_LINEUP;
  const fielderIds = Object.values(current.fieldPositions).filter(Boolean) as string[];
  const assigned = new Set(fielderIds);
  const dh = current.lineup.find((id) => !assigned.has(id)) ?? '';

  const update = (next: Partial<SavedLineup>) => {
    setDraft({ ...current, ...next });
    setDirty(true);
  };

  const setField = (pos: string, id: string) => {
    const fieldPositions = { ...current.fieldPositions };
    if (id) fieldPositions[pos as keyof typeof fieldPositions] = id;
    else delete fieldPositions[pos as keyof typeof fieldPositions];
    // A card given a field spot is no longer the DH.
    const nextDh = id !== '' && dh === id ? '' : dh;
    update({ fieldPositions, lineup: withMembers(current.lineup, fieldPositions, nextDh) });
  };

  const setDh = (id: string) => update({ lineup: withMembers(current.lineup, current.fieldPositions, id) });

  const setPitcher = (id: string) => update({ startingPitcherId: id });

  /** Move a hitter up or down the batting order. */
  const move = (id: string, delta: number) => {
    const order = [...current.lineup];
    const i = order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    update({ lineup: order });
  };

  const problem = useMemo(() => {
    const missing = FIELD.filter((f) => !current.fieldPositions[f.pos as keyof typeof current.fieldPositions]);
    if (missing.length) return `Assign ${missing.map((m) => m.pos).join(', ')}.`;
    if (new Set(fielderIds).size !== fielderIds.length) return 'Two positions are assigned to the same player.';
    if (!dh) return 'Pick a designated hitter.';
    if (current.lineup.length !== 9) return 'The lineup needs nine hitters.';
    if (!current.startingPitcherId) return 'Pick a starting pitcher.';
    return null;
  }, [current, dh, fielderIds]);

  const save = useAction(async () => {
    if (problem) return;
    const { team: updated } = await api.updateTeam(team.id, { lineup: current });
    onSaved(updated);
    setDirty(false);
  });

  const playerLabel = (entry: RosterEntryView) => `${entry.card.name} (${entry.card.cardYear})`;
  const nameOf = (id: string) => hitters.find((r) => String(r.teamCardId) === id)?.card.name ?? id;
  const spotOf = (id: string): string => {
    for (const [pos, pid] of Object.entries(current.fieldPositions)) if (pid === id) return pos;
    return id === dh ? 'DH' : '—';
  };

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
          <select className={inputClass} value={current.startingPitcherId} onChange={(e) => setPitcher(e.target.value)}>
            <option value="">— nobody —</option>
            {pitchers.map((r) => (
              <option key={r.id} value={String(r.teamCardId)}>
                {playerLabel(r)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-6 border-t border-white/10 pt-4">
        <h3 className="font-display text-lg font-semibold text-chalk">Batting order</h3>
        <p className="mb-3 text-sm text-chalk/55">Number one leads off. Move a hitter up or down to set the order.</p>
        {current.lineup.length === 0 ? (
          <p className="text-sm text-chalk/50">Assign positions above and the hitters will line up here.</p>
        ) : (
          <ol className="space-y-1.5">
            {current.lineup.map((id, i) => (
              <li key={id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <span className="w-5 shrink-0 font-mono text-sm text-chalk/45">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-chalk">{nameOf(id)}</span>
                <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 font-mono text-xs text-chalk/70">{spotOf(id)}</span>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${nameOf(id)} up the order`}
                    disabled={i === 0}
                    onClick={() => move(id, -1)}
                    className="rounded-full border border-white/20 px-2 py-0.5 text-xs text-chalk/75 hover:bg-white/10 disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${nameOf(id)} down the order`}
                    disabled={i === current.lineup.length - 1}
                    onClick={() => move(id, 1)}
                    className="rounded-full border border-white/20 px-2 py-0.5 text-xs text-chalk/75 hover:bg-white/10 disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {problem ? <p className="mt-3 text-sm text-chalk/50">{problem}</p> : null}
      <ErrorNote error={save.error} />
      <ErrorNote error={team.lineupProblem ? new Error(team.lineupProblem) : null} />
    </Panel>
  );
}

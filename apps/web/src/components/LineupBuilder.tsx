import { useMemo } from 'react';
import { OUT_OF_POSITION_RATING } from '@cardball/engine';
import type { Position, SavedLineup } from '@cardball/shared';
import { Field, inputClass } from './ui.js';

/**
 * The lineup card, once.
 *
 * TeamPage, the game lobby, and the draft assembly all ask a manager to set the
 * same thing: eight fielders, a designated hitter, and a starting pitcher, in
 * an order. This component holds that interaction, so the three places that
 * need it cannot drift. It is controlled — the caller owns the lineup and hears
 * every change — because each caller saves it somewhere different (a team
 * record, a set-lineup action, a draft's lineup lock).
 */

/** The eight field spots, in the order a scorecard lists them. */
export const FIELD_SPOTS: readonly { pos: Position; label: string }[] = [
  { pos: 'C', label: 'Catcher' },
  { pos: '1B', label: 'First base' },
  { pos: '2B', label: 'Second base' },
  { pos: '3B', label: 'Third base' },
  { pos: 'SS', label: 'Shortstop' },
  { pos: 'LF', label: 'Left field' },
  { pos: 'CF', label: 'Center field' },
  { pos: 'RF', label: 'Right field' },
];

/** A card the manager can put in the lineup, whatever it is keyed by. */
export interface LineupCandidate {
  /** the id the lineup stores: a team-card id, a draft-card id, or an engine id */
  id: string;
  name: string;
  cardYear: number;
  positions: Position[];
  pitcherClass: 'SP' | 'RP' | null;
  /** the card can bat (has an eligible hitting season) */
  canBat: boolean;
}

export const EMPTY_LINEUP: SavedLineup = { lineup: [], fieldPositions: {}, startingPitcherId: '' };

/**
 * Keep the batting order a permutation of exactly the eight fielders plus the
 * designated hitter. Cards already in the order keep their place; a card just
 * given a spot is appended, so a manager can assign positions first and then
 * move the order into shape.
 */
export function withMembers(order: string[], fieldPositions: SavedLineup['fieldPositions'], dhId: string): string[] {
  const members = new Set([...(Object.values(fieldPositions).filter(Boolean) as string[]), dhId].filter((id) => id !== ''));
  const kept = order.filter((id) => members.has(id));
  const added = [...members].filter((id) => !kept.includes(id));
  return [...kept, ...added];
}

/** The reason this lineup is not legal yet, or null when it is. */
export function lineupProblem(candidates: LineupCandidate[], lineup: SavedLineup): string | null {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const fielderIds = Object.values(lineup.fieldPositions).filter(Boolean) as string[];
  const assigned = new Set(fielderIds);

  const missing = FIELD_SPOTS.filter((f) => !lineup.fieldPositions[f.pos]);
  if (missing.length) return `Assign ${missing.map((m) => m.pos).join(', ')}.`;
  for (const id of fielderIds) {
    const player = byId.get(id);
    if (player && !player.canBat) return `${player.name}'s card cannot bat in this game.`;
  }
  if (new Set(fielderIds).size !== fielderIds.length) return 'Two positions are assigned to the same player.';

  const dh = lineup.lineup.find((id) => !assigned.has(id)) ?? '';
  if (!dh) return 'Pick a designated hitter.';
  if (lineup.lineup.length !== 9) return 'The lineup needs nine hitters.';
  if (new Set(lineup.lineup).size !== 9) return 'The lineup has a player twice.';

  if (!lineup.startingPitcherId) return 'Pick a starting pitcher.';
  if (assigned.has(lineup.startingPitcherId) || lineup.lineup.includes(lineup.startingPitcherId)) {
    return 'The pitcher does not bat — keep him out of the lineup.';
  }
  const pitcher = byId.get(lineup.startingPitcherId);
  if (pitcher && pitcher.pitcherClass !== 'SP') return `${pitcher.name} is not a starting pitcher.`;
  return null;
}

export function LineupBuilder({
  candidates,
  value,
  onChange,
  outOfPosition = false,
}: {
  candidates: LineupCandidate[];
  value: SavedLineup;
  onChange: (next: SavedLineup) => void;
  /** starters may field a position their card doesn't list (tournaments) */
  outOfPosition?: boolean;
}) {
  const hitters = useMemo(() => candidates.filter((c) => c.canBat), [candidates]);
  const pitchers = useMemo(() => candidates.filter((c) => c.pitcherClass === 'SP'), [candidates]);

  const current = value;
  const fielderIds = Object.values(current.fieldPositions).filter(Boolean) as string[];
  const assigned = new Set(fielderIds);
  const dh = current.lineup.find((id) => !assigned.has(id)) ?? '';

  const update = (next: Partial<SavedLineup>) => onChange({ ...current, ...next });

  const setField = (pos: Position, id: string) => {
    const fieldPositions = { ...current.fieldPositions };
    if (id) fieldPositions[pos] = id;
    else delete fieldPositions[pos];
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

  const label = (c: LineupCandidate) => `${c.name} (${c.cardYear})`;
  const nameOf = (id: string) => candidates.find((c) => c.id === id)?.name ?? id;
  const spotOf = (id: string): string => {
    for (const [pos, pid] of Object.entries(current.fieldPositions)) if (pid === id) return pos;
    return id === dh ? 'DH' : '—';
  };

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELD_SPOTS.map(({ pos, label: posLabel }) => {
          const eligible = hitters.filter((c) => c.positions.includes(pos));
          const offCard = outOfPosition ? hitters.filter((c) => !c.positions.includes(pos)) : [];
          const selected = (current.fieldPositions[pos] as string | undefined) ?? '';
          return (
            <Field key={pos} label={`${pos} · ${posLabel}`}>
              <select className={inputClass} value={selected} onChange={(e) => setField(pos, e.target.value)}>
                <option value="">— nobody —</option>
                {eligible.map((c) => (
                  <option key={c.id} value={c.id}>
                    {label(c)}
                  </option>
                ))}
                {offCard.length ? (
                  <optgroup label={`Out of position (fielding ${OUT_OF_POSITION_RATING})`}>
                    {offCard.map((c) => (
                      <option key={c.id} value={c.id}>
                        {label(c)}
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
              .filter((c) => !assigned.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c)}
                </option>
              ))}
          </select>
        </Field>

        <Field label="SP · Starting pitcher">
          <select className={inputClass} value={current.startingPitcherId} onChange={(e) => setPitcher(e.target.value)}>
            <option value="">— nobody —</option>
            {pitchers.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c)}
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
    </div>
  );
}

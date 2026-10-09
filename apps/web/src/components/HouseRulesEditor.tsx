/**
 * The house-rules editor.
 *
 * Every number the game reads is editable here: the card-building thresholds,
 * the mound limits, the dice targets, and the four stat tables printed on the
 * card back. Saving publishes the rules to the server, which republishes them
 * to every card face and to new games. Games already under way keep the rules
 * they were created with.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import { INFIELD_POSITIONS, OUTFIELD_POSITIONS, defaultHouseRules } from '@cardball/shared';
import type { HouseRules, Position, PowerTier, SprayDirection } from '@cardball/shared';
import { api } from '../api.js';
import { Button, ErrorNote, Field, Panel, inputClass, useAction } from './ui.js';

const fmtMod = (mod: number) => (mod > 0 ? `+${mod}` : String(mod));
const fmtAvg = (n: number) => n.toFixed(3).replace(/^0/, '');

export function HouseRulesEditor({ initial, onSaved }: { initial: HouseRules; onSaved: (rules: HouseRules) => void }) {
  const [draft, setDraft] = useState<HouseRules>(initial);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof HouseRules>(key: K, value: HouseRules[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  const save = useAction(async () => {
    const { rules } = await api.saveHouseRules(draft);
    setDraft(rules);
    setDirty(false);
    onSaved(rules);
  });

  return (
    <Panel
      title="House rules"
      subtitle="These are the tunables that were never printed on the ball card. They apply to new games; a game in progress keeps the rules it started with."
      actions={
        <>
          <Button
            disabled={save.busy}
            onClick={() => {
              setDraft(defaultHouseRules());
              setDirty(true);
            }}
          >
            Reset to shipped
          </Button>
          <Button variant="primary" disabled={!dirty || save.busy} onClick={() => void save.execute()}>
            {save.busy ? 'Saving…' : dirty ? 'Save rules' : 'Saved'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ErrorNote error={save.error} />

        <Group title="Building a card">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberField label="Stat window" hint="seasons on the card back" value={draft.statWindowSeasons} min={1} max={12} onChange={(v) => set('statWindowSeasons', v)} />
            <NumberField label="Full-game AB" hint="at-bats for a healthy season" value={draft.fullGameAb} min={0} max={700} onChange={(v) => set('fullGameAb', v)} />
            <NumberField label="Healthy pitching" hint="outs on the mound (120 = 40 IP)" value={draft.pitcherInjuryIpOuts} min={0} max={1200} onChange={(v) => set('pitcherInjuryIpOuts', v)} />
            <NumberField label="Starter threshold" hint="innings in a season to be an SP" value={draft.starterIpThreshold} min={0} max={300} onChange={(v) => set('starterIpThreshold', v)} />
            <NumberField label="Position eligibility" hint="games at a spot to field it" value={draft.positionEligibilityGames} min={0} max={162} onChange={(v) => set('positionEligibilityGames', v)} />
            <NumberField label="Fielding rating floor" hint="games before a rating replaces neutral" value={draft.fieldingRatingMinGames} min={0} max={162} onChange={(v) => set('fieldingRatingMinGames', v)} />
          </div>
        </Group>

        <Group title="The mound">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              label="Starter fresh innings"
              hint="full-strength innings for a starter in a 9-inning game"
              value={draft.starterFreshInnings}
              min={0}
              max={12}
              onChange={(v) => set('starterFreshInnings', v)}
            />
            <NumberField
              label="Fatigue per inning"
              hint="pitch-roll penalty per fatigued inning"
              value={draft.fatiguePerInning}
              min={0}
              max={5}
              onChange={(v) => set('fatiguePerInning', v)}
            />
          </div>
          <p className="mt-3 text-xs text-chalk/50">
            A pitcher stays in as long as his manager will have him — every fatigued inning just costs him on the pitch roll. The
            fresh-innings allowance scales down for shorter games.
          </p>
        </Group>

        <Group title="At the plate and on the bases">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField label="Walk after" hint="tied pitch rolls" value={draft.walkBalls} min={1} max={12} onChange={(v) => set('walkBalls', v)} />
            <NumberField label="Double-play target" hint="the factors must beat this" value={draft.dpTarget} min={0} max={60} onChange={(v) => set('dpTarget', v)} />
            <NumberField label="Throw to 3rd" hint="catcher bonus" value={draft.stealThirdCatcherBonus} min={0} max={6} onChange={(v) => set('stealThirdCatcherBonus', v)} />
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-gold)]"
                checked={draft.sendRerollOnes}
                onChange={(e) => set('sendRerollOnes', e.target.checked)}
              />
              <span className="text-sm text-chalk/80">Re-roll 1s on a send</span>
            </label>
          </div>
        </Group>

        <Group title="Game lengths offered">
          <div className="flex flex-wrap items-center gap-2">
            {[3, 6, 9, 12].map((n) => {
              const on = draft.regulationInningsOptions.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  className={`rounded-full px-3 py-1 text-sm transition-colors ${
                    on ? 'bg-chalk text-field-deep' : 'border border-white/15 text-chalk/70 hover:bg-white/10'
                  }`}
                  onClick={() =>
                    set(
                      'regulationInningsOptions',
                      (on ? draft.regulationInningsOptions.filter((x) => x !== n) : [...draft.regulationInningsOptions, n]).sort((a, b) => a - b),
                    )
                  }
                >
                  {n} innings
                </button>
              );
            })}
          </div>
        </Group>

        <Group title="The stat tables printed on the card">
          <div className="grid gap-4 lg:grid-cols-2">
            <BandTable
              title="HIT — from AVG"
              hint="The highest threshold the average clears wins. The bottom row catches everything else."
              field="min"
              label="AVG ≥"
              format={fmtAvg}
              rows={draft.hitBands}
              onChange={(rows) => set('hitBands', rows)}
            />
            <BandTable
              title="PIT — from ERA"
              hint="The lowest threshold the ERA fits wins, because lower is better."
              field="max"
              label="ERA ≤"
              format={(n) => n.toFixed(2)}
              rows={draft.pitBands}
              onChange={(rows) => set('pitBands', rows)}
            />
            <BandTable
              title="SB — from steals"
              hint="Used for steals, sends, and the double-play factor."
              field="min"
              label="SB ≥"
              format={String}
              rows={draft.sbBands}
              onChange={(rows) => set('sbBands', rows)}
            />
            <BandTable
              title="RBI bonus"
              hint="With a runner in scoring position, added to the batter's pitch roll."
              field="min"
              label="RBI ≥"
              format={String}
              rows={draft.rbiBands}
              onChange={(rows) => set('rbiBands', rows)}
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Red contact rolls" hint="baserunners get +1. Comma-separated d20 faces.">
              <input
                className={inputClass}
                value={draft.runnerAdvantage.red.join(', ')}
                onChange={(e) => set('runnerAdvantage', { ...draft.runnerAdvantage, red: numberList(e.target.value, 1, 20) })}
              />
            </Field>
            <Field label="Blue contact rolls" hint="baserunners get −1.">
              <input
                className={inputClass}
                value={draft.runnerAdvantage.blue.join(', ')}
                onChange={(e) => set('runnerAdvantage', { ...draft.runnerAdvantage, blue: numberList(e.target.value, 1, 20) })}
              />
            </Field>
          </div>

          <PowerTierTable tiers={draft.powerTiers} onChange={(tiers) => set('powerTiers', tiers)} />
          <SprayChartTable chart={draft.sprayChart} onChange={(chart) => set('sprayChart', chart)} />
        </Group>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-black/15 p-4">
      <h3 className="mb-3 font-display text-base font-semibold text-chalk">{title}</h3>
      {children}
    </section>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        className={inputClass}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, Math.round(next))));
        }}
      />
    </Field>
  );
}

/**
 * A threshold/modifier table: add a row, change a row, delete a row.
 * `field` names the threshold column, so HIT/SB/RBI edit `min` and PIT edits
 * `max`, without either table pretending to be the other.
 */
function BandTable<T extends { mod: number }>({
  title,
  hint,
  rows,
  field,
  label,
  format,
  onChange,
}: {
  title: string;
  hint: string;
  rows: T[];
  field: 'min' | 'max';
  label: string;
  format: (n: number) => string;
  onChange: (rows: T[]) => void;
}) {
  const threshold = (band: T) => (band as Record<string, number>)[field] ?? 0;
  const update = (index: number, patch: { [key: string]: number }) => {
    onChange(rows.map((r, i) => (i === index ? ({ ...r, ...patch } as T) : r)));
  };
  const inForce = [...rows].sort((a, b) => (field === 'min' ? threshold(b) - threshold(a) : threshold(a) - threshold(b)));

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h4 className="font-display text-sm font-semibold text-chalk">{title}</h4>
          <p className="mt-0.5 text-xs text-chalk/50">{hint}</p>
        </div>
        <Button size="sm" onClick={() => onChange([...rows, { min: 0, max: 0, mod: 0 } as unknown as T])}>
          Add row
        </Button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-chalk/45">
            <th className="pb-1 font-medium">{label}</th>
            <th className="pb-1 font-medium">Mod</th>
            <th className="pb-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map((band, i) => (
            <tr key={i} className="border-t border-white/5">
              <td className="py-1 pr-2">
                <input
                  type="number"
                  step="0.001"
                  aria-label={`${title} threshold ${i + 1}`}
                  className="w-24 rounded border border-white/15 bg-black/30 px-2 py-1 font-mono text-chalk"
                  value={threshold(band)}
                  onChange={(e) => update(i, { [field]: Number(e.target.value) || 0 })}
                />
              </td>
              <td className="py-1 pr-2">
                <input
                  type="number"
                  aria-label={`${title} modifier ${i + 1}`}
                  className="w-16 rounded border border-white/15 bg-black/30 px-2 py-1 font-mono text-chalk"
                  value={band.mod}
                  onChange={(e) => update(i, { mod: Number(e.target.value) || 0 })}
                />
              </td>
              <td className="py-1 text-right whitespace-nowrap">
                <span className="mr-2 font-mono text-chalk/40">{fmtMod(band.mod)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${title} row ${i + 1}`}
                  className="text-chalk/40 transition-colors hover:text-crimson"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 font-mono text-[11px] text-chalk/40">
        in force: {inForce.map((b) => `${format(threshold(b))}→${fmtMod(b.mod)}`).join('  ')}
      </p>
    </div>
  );
}

function PowerTierTable({ tiers, onChange }: { tiers: PowerTier[]; onChange: (tiers: PowerTier[]) => void }) {
  const update = (index: number, patch: Partial<PowerTier>) => {
    onChange(tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h4 className="font-display text-sm font-semibold text-chalk">Power tiers</h4>
          <p className="mt-0.5 text-xs text-chalk/50">
            On an unfielded contact roll in the band, the best season threshold the player clears wins: home run, then triple, then double. Rolls
            below 10 are always singles and a natural 20 is always a home run.
          </p>
        </div>
        <Button size="sm" onClick={() => onChange([...tiers, { min: 10, max: 14, thresholds: { doubles: 35, triples: 10, homeRuns: 40 } }])}>
          Add tier
        </Button>
      </div>
      <div className="space-y-2">
        {tiers.map((tier, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3 border-t border-white/5 pt-2">
            <TinyNumber label="d20 from" value={tier.min} onChange={(v) => update(i, { min: v })} />
            <TinyNumber label="to" value={tier.max} onChange={(v) => update(i, { max: v })} />
            <TinyNumber label="2B ≥" value={tier.thresholds.doubles} onChange={(v) => update(i, { thresholds: { ...tier.thresholds, doubles: v } })} />
            <TinyNumber label="3B ≥" value={tier.thresholds.triples} onChange={(v) => update(i, { thresholds: { ...tier.thresholds, triples: v } })} />
            <TinyNumber label="HR ≥" value={tier.thresholds.homeRuns} onChange={(v) => update(i, { thresholds: { ...tier.thresholds, homeRuns: v } })} />
            <button
              type="button"
              aria-label={`Remove power tier ${i + 1}`}
              className="pb-2 text-chalk/40 transition-colors hover:text-crimson"
              onClick={() => onChange(tiers.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TinyNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold tracking-wide text-chalk/50 uppercase">{label}</span>
      <input
        type="number"
        className="w-20 rounded border border-white/15 bg-black/30 px-2 py-1 font-mono text-sm text-chalk"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </label>
  );
}

function SprayChartTable({ chart, onChange }: { chart: SprayDirection[]; onChange: (chart: SprayDirection[]) => void }) {
  const toggle = (roll: number, kind: 'infield' | 'outfield', pos: Position) => {
    onChange(
      chart.map((d) => {
        if (d.roll !== roll) return d;
        const list = d[kind];
        return { ...d, [kind]: list.includes(pos) ? list.filter((p) => p !== pos) : [...list, pos] };
      }),
    );
  };
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
      <h4 className="font-display text-sm font-semibold text-chalk">Spray chart</h4>
      <p className="mt-0.5 mb-3 text-xs text-chalk/50">
        The hit-direction d6 sends the ball to one of these defenders. Contact rolls of 10 or less look infield; 11 or more look outfield. The best
        fielder among them makes the play.
      </p>
      <div className="space-y-2">
        {[...chart]
          .sort((a, b) => a.roll - b.roll)
          .map((dir) => (
            <div key={dir.roll} className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-2">
              <span className="w-12 font-mono text-xs text-chalk/50">d6 {dir.roll}</span>
              <PositionChips label="IF" positions={INFIELD_POSITIONS} chosen={dir.infield} onToggle={(pos) => toggle(dir.roll, 'infield', pos)} />
              <PositionChips label="OF" positions={OUTFIELD_POSITIONS} chosen={dir.outfield} onToggle={(pos) => toggle(dir.roll, 'outfield', pos)} />
            </div>
          ))}
      </div>
    </div>
  );
}

function PositionChips({
  label,
  positions,
  chosen,
  onToggle,
}: {
  label: string;
  positions: readonly Position[];
  chosen: Position[];
  onToggle: (pos: Position) => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="font-mono text-[10px] tracking-wide text-chalk/40 uppercase">{label}</span>
      {positions.map((pos) => {
        const on = chosen.includes(pos);
        return (
          <button
            key={pos}
            type="button"
            aria-pressed={on}
            className={`rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
              on ? 'bg-gold text-ink' : 'border border-white/15 text-chalk/60 hover:bg-white/10'
            }`}
            onClick={() => onToggle(pos)}
          >
            {pos}
          </button>
        );
      })}
    </span>
  );
}

/** "8, 9" → [8, 9], dropping junk and out-of-range faces. */
function numberList(text: string, min: number, max: number): number[] {
  return [
    ...new Set(
      text
        .split(/[^0-9.]+/)
        .map((t) => Number(t))
        .filter((n) => Number.isFinite(n) && n >= min && n <= max)
        .map((n) => Math.round(n)),
    ),
  ].sort((a, b) => a - b);
}

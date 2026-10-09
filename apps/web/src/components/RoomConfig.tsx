import { ERAS } from '../eras.js';
import { PACK_THEMES, packThemesForYears } from '@cardball/shared';
import type { PackThemeId } from '@cardball/shared';
import { PackArt } from './PackArt.js';
import { Field, inputClass } from './ui.js';

/**
 * The pieces every room-setup form asks for: what years of cards are allowed,
 * which packs get dealt, how big the room is, and how many specials are fair.
 * Games, drafts, and tournaments all send these, so they live here once.
 * Everything is controlled — the page owns the state and the payload.
 */

/** The themes a room can still deal after the years change; the rest are not offered. */
export function chosenThemes(themes: PackThemeId[], yearFrom: number, yearTo: number): PackThemeId[] {
  const offered = new Set(packThemesForYears(yearFrom, yearTo).map((t) => t.id));
  return themes.filter((t) => offered.has(t));
}

/**
 * A row of joined pill buttons with exactly one option on. The choice is
 * reported with aria-pressed so the state reads out without seeing the fill.
 */
export function SegmentedToggle<T extends string | number>({
  value,
  options,
  onChange,
  namePrefix,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  /** names each button `${namePrefix}-${value}`, which the old forms did for tests */
  namePrefix: string;
}) {
  return (
    <div className="flex gap-1 rounded-full border border-white/15 p-1">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            name={`${namePrefix}-${String(option.value)}`}
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-full px-2 py-1.5 text-sm transition-colors ${
              on ? 'bg-chalk text-field-deep font-semibold' : 'text-chalk/70 hover:bg-white/10'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * An era preset plus the year range it stands for. Picking a preset or typing a
 * year both come back through the page, because a draft also has to drop the
 * packs an era no longer deals.
 */
export function EraRangePicker({
  era,
  onEraChange,
  yearFrom,
  yearTo,
  onYearsChange,
  minYear,
  maxYear,
  anyEraRange,
  selectName = 'era',
  label = 'Era',
  hint,
  yearsRequired = false,
}: {
  era: string;
  onEraChange: (id: string) => void;
  yearFrom: number;
  yearTo: number;
  /** typing a year is what makes the range custom */
  onYearsChange: (years: { yearFrom: number; yearTo: number }) => void;
  minYear: number;
  maxYear: number;
  /** when the room counts "any era" from its own limits, not the era preset's years */
  anyEraRange?: { from: number; to: number };
  selectName?: string;
  label?: string;
  hint?: string;
  yearsRequired?: boolean;
}) {
  return (
    <>
      <Field label={label} hint={hint}>
        <select name={selectName} className={inputClass} value={era} onChange={(e) => onEraChange(e.target.value)}>
          {anyEraRange ? (
            <option value="any">
              Any era · {anyEraRange.from}–{anyEraRange.to}
            </option>
          ) : null}
          {ERAS.filter((e) => e.id !== 'any' || !anyEraRange).map((e) => (
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
            min={minYear}
            max={maxYear}
            value={yearFrom}
            required={yearsRequired}
            onChange={(e) => onYearsChange({ yearFrom: Number(e.target.value), yearTo })}
          />
        </Field>
        <Field label="through">
          <input
            name="yearTo"
            type="number"
            className={inputClass}
            min={minYear}
            max={maxYear}
            value={yearTo}
            required={yearsRequired}
            onChange={(e) => onYearsChange({ yearFrom, yearTo: Number(e.target.value) })}
          />
        </Field>
      </div>
    </>
  );
}

/**
 * The packs a room may deal. A theme that cannot be built from the chosen years
 * stays in the list but disabled, so the options never reshuffle under the
 * pointer — and it is dropped from the payload, not just greyed out.
 */
export function PackThemePicker({
  themes,
  yearFrom,
  yearTo,
  onChange,
}: {
  themes: PackThemeId[];
  yearFrom: number;
  yearTo: number;
  onChange: (themes: PackThemeId[]) => void;
}) {
  const offeredIds = new Set(packThemesForYears(yearFrom, yearTo).map((t) => t.id));
  const chosen = themes.filter((t) => offeredIds.has(t));
  const toggle = (id: PackThemeId) => onChange(themes.includes(id) ? themes.filter((t) => t !== id) : [...themes, id]);

  return (
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
                aria-pressed={on}
                onClick={() => toggle(t.id)}
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
  );
}

/**
 * How many rare, star, and mythic cards one manager may hold. Zero is "no cap",
 * which the rooms send as a null rarityCaps rather than a row of zeroes.
 */
export function RarityCapFields({
  rare,
  star,
  mythic,
  onRareChange,
  onStarChange,
  onMythicChange,
  maxRare,
  maxStar,
  maxMythic,
}: {
  rare: number;
  star: number;
  mythic: number;
  onRareChange: (value: number) => void;
  onStarChange: (value: number) => void;
  onMythicChange: (value: number) => void;
  maxRare: number;
  maxStar: number;
  maxMythic: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="Most rare each (0 = no cap)">
        <input
          name="maxRare"
          type="number"
          className={inputClass}
          min={0}
          max={maxRare}
          value={rare}
          onChange={(e) => onRareChange(Number(e.target.value))}
        />
      </Field>
      <Field label="Most star each (0 = no cap)">
        <input
          name="maxStar"
          type="number"
          className={inputClass}
          min={0}
          max={maxStar}
          value={star}
          onChange={(e) => onStarChange(Number(e.target.value))}
        />
      </Field>
      <Field label="Most mythic each (0 = no cap)">
        <input
          name="maxMythic"
          type="number"
          className={inputClass}
          min={0}
          max={maxMythic}
          value={mythic}
          onChange={(e) => onMythicChange(Number(e.target.value))}
        />
      </Field>
    </div>
  );
}

/** How many packs each manager opens, and how many cards sit inside one. */
export function RoundSizeFields({
  rounds,
  packSize,
  onRoundsChange,
  onPackSizeChange,
  maxRounds,
  minRounds = 1,
  minPackSize,
  maxPackSize,
}: {
  rounds: number;
  packSize: number;
  onRoundsChange: (value: number) => void;
  onPackSizeChange: (value: number) => void;
  maxRounds: number;
  minRounds?: number;
  minPackSize: number;
  maxPackSize: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Packs each">
        <select name="rounds" className={inputClass} value={rounds} onChange={(e) => onRoundsChange(Number(e.target.value))}>
          {Array.from({ length: maxRounds }, (_, i) => i + minRounds).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cards per pack">
        <select name="packSize" className={inputClass} value={packSize} onChange={(e) => onPackSizeChange(Number(e.target.value))}>
          {Array.from({ length: maxPackSize - minPackSize + 1 }, (_, i) => i + minPackSize).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

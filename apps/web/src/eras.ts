/**
 * Era shortcuts, so nobody has to type two years to get a vibe. Shared by the
 * draft form and the game form, because both ask the same question: what years
 * of cards are we playing with?
 */
export const THIS_YEAR = new Date().getFullYear();

export interface Era {
  id: string;
  label: string;
  from: number;
  to: number;
}

export const ERAS: readonly Era[] = [
  { id: 'any', label: 'Any era', from: 1901, to: THIS_YEAR },
  { id: 'deadball', label: 'Deadball', from: 1901, to: 1919 },
  { id: 'golden', label: 'Golden age', from: 1920, to: 1946 },
  { id: 'integration', label: 'Integration', from: 1947, to: 1960 },
  { id: 'expansion', label: 'Expansion', from: 1961, to: 1992 },
  { id: 'modern', label: 'Modern', from: 1993, to: THIS_YEAR },
];

export function eraById(id: string): Era | undefined {
  return ERAS.find((e) => e.id === id);
}

/** The preset whose range matches these years, or null for a custom range. */
export function eraFor(from: number, to: number): Era | null {
  return ERAS.find((e) => e.from === from && e.to === to) ?? null;
}

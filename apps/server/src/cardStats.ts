import { and, desc, eq } from 'drizzle-orm';
import { collectionLines } from '@cardball/engine';
import type { GameState } from '@cardball/engine';
import { addBattingLines, addPitchingLines, emptyBattingLine, emptyPitchingLine } from '@cardball/shared';
import type { BattingLine, CardCareer, CardGameLine, PitchingLine } from '@cardball/shared';
import { cardGameLines, userCards } from '@cardball/db';
import type { Ctx } from './context.js';
import { notFound } from './http.js';

type Tx = Parameters<Parameters<Ctx['db']['transaction']>[0]>[0];

/**
 * Write each collection card's line from a game that just ended. A card on
 * both teams (a hotseat game against yourself) gets one row with both lines
 * added together. Safe to call twice: a game's rows are only written once.
 */
export async function recordCardLines(db: Ctx['db'] | Tx, gameId: number, engine: GameState): Promise<void> {
  if (engine.phase !== 'finished') return;
  const byCard = new Map<number, typeof cardGameLines.$inferInsert>();
  for (const line of collectionLines(engine)) {
    const team = engine[line.side];
    const opponent = engine[line.side === 'home' ? 'away' : 'home'];
    const existing = byCard.get(line.userCardId);
    if (existing) {
      existing.batting = mergeBatting(existing.batting ?? null, line.batting);
      existing.pitching = mergePitching(existing.pitching ?? null, line.pitching);
      continue;
    }
    byCard.set(line.userCardId, {
      gameId,
      userCardId: line.userCardId,
      teamName: team.name,
      opponentName: opponent.name,
      won: engine.winner === line.side,
      batting: line.batting,
      pitching: line.pitching,
    });
  }
  if (byCard.size === 0) return;
  await db.insert(cardGameLines).values([...byCard.values()]).onConflictDoNothing();
}

function mergeBatting(a: BattingLine | null, b: BattingLine | null): BattingLine | null {
  if (!a) return b;
  return b ? addBattingLines(a, b) : a;
}

function mergePitching(a: PitchingLine | null, b: PitchingLine | null): PitchingLine | null {
  if (!a) return b;
  return b ? addPitchingLines(a, b) : a;
}

/** A collection card's totals across every finished game, for its owner. */
export async function cardCareer(ctx: Ctx, userId: number, userCardId: number): Promise<CardCareer> {
  const [owned] = await ctx.db
    .select({ id: userCards.id })
    .from(userCards)
    .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId)))
    .limit(1);
  if (!owned) throw notFound('Card not found');

  const rows = await ctx.db.select().from(cardGameLines).where(eq(cardGameLines.userCardId, userCardId)).orderBy(desc(cardGameLines.playedAt));
  let batting: BattingLine | null = null;
  let pitching: PitchingLine | null = null;
  for (const row of rows) {
    if (row.batting) batting = addBattingLines(batting ?? emptyBattingLine(), row.batting);
    if (row.pitching) pitching = addPitchingLines(pitching ?? emptyPitchingLine(), row.pitching);
  }
  const recent: CardGameLine[] = rows.slice(0, 20).map((row) => ({
    gameId: row.gameId,
    playedAt: row.playedAt.toISOString(),
    teamName: row.teamName,
    opponentName: row.opponentName,
    won: row.won,
    batting: row.batting ?? null,
    pitching: row.pitching ?? null,
  }));
  return { userCardId, games: rows.length, batting, pitching, recent };
}

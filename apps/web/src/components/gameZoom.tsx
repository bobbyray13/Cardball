import { lineFor } from '@cardball/engine';
import type { EnginePlayer, GameState, Side } from '@cardball/engine';
import { formatBattingLine, formatPitchingLine } from '@cardball/shared';
import { snapshotOfPlayer } from './CardZoom.js';
import type { ZoomTarget } from './CardZoom.js';

/** A player's card, zoomed, with what he has done so far today. */
export function zoomForPlayer(state: GameState, side: Side, player: EnginePlayer, photos: Record<string, number>, viewerId: number | null): ZoomTarget {
  const { batting, pitching } = lineFor(state, side, player.id);
  const bat = batting ? formatBattingLine(batting) : '';
  const pit = pitching ? formatPitchingLine(pitching) : '';
  return {
    card: snapshotOfPlayer(player),
    photoId: photos[player.id] ?? null,
    rarity: player.rarity,
    // Career lines are private to the card's owner.
    userCardId: viewerId !== null && state[side].userId === viewerId ? player.userCardId : null,
    details: (
      <div>
        <p className="text-xs font-semibold tracking-wide text-chalk/55 uppercase">Today · {state[side].name}</p>
        {bat || pit ? (
          <div className="mt-1 space-y-0.5 font-mono text-sm text-chalk">
            {bat ? <p>{bat}</p> : null}
            {pit ? <p>{pit}</p> : null}
          </div>
        ) : (
          <p className="mt-1 text-sm text-chalk/50">Hasn't done anything in this one yet.</p>
        )}
      </div>
    ),
  };
}

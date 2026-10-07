import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { REWARDS, activeHouseRules } from '@cardball/shared';
import type { ChallengeView } from '@cardball/shared';
import { api } from '../api.js';
import { teamColors } from '../components/BallCard.js';
import { Button, EmptyState, ErrorNote, Panel, Spinner, useAction, useLoad } from '../components/ui.js';

/**
 * Historic team collections: one iconic season from every active franchise,
 * with its lineup pre-built from the record books. Collect a card that covers
 * the season for every player on the list and the collection pays out packs.
 */
export function ChallengesPage() {
  const challenges = useLoad(() => api.challenges(), []);
  const [selected, setSelected] = useState<ChallengeView | null>(null);

  const list = useMemo(() => challenges.data?.challenges ?? [], [challenges.data]);
  const done = list.filter((c) => c.complete).length;
  const window = activeHouseRules().statWindowSeasons;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-chalk">Historic collections</h1>
          <p className="mt-1 text-sm text-chalk/60">
            One great team from every franchise. Collect a card covering the season for every player listed and{' '}
            {REWARDS.perChallenge} packs land on your shelf.
          </p>
        </div>
        <p className="text-sm text-chalk/60">
          {done} of {list.length} complete
        </p>
      </div>

      <ErrorNote error={challenges.error} />
      {challenges.loading && !challenges.data ? (
        <Spinner label="Dusting off the record books…" />
      ) : list.length === 0 ? (
        <EmptyState title="No collections yet" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((challenge) => (
            <ChallengeCard key={challenge.id} challenge={challenge} onOpen={() => setSelected(challenge)} />
          ))}
        </div>
      )}

      {selected ? <ChallengeDetail challengeId={selected.id} onClose={() => setSelected(null)} window={window} /> : null}
    </div>
  );
}

function ChallengeCard({ challenge, onOpen }: { challenge: ChallengeView; onOpen: () => void }) {
  const colors = teamColors(challenge.franchise);
  const percent = challenge.total === 0 ? 0 : Math.round((challenge.owned / challenge.total) * 100);

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      className="group relative overflow-hidden rounded-2xl border border-white/10 text-left transition-transform hover:-translate-y-1 hover:border-gold/40"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label={`${challenge.name}, ${challenge.owned} of ${challenge.total} collected`}
    >
      <div
        className="relative px-4 pt-4 pb-3"
        style={{ background: `linear-gradient(120deg, ${colors.primary}, ${colors.secondary})` }}
      >
        <p className="font-display text-xl leading-tight font-bold text-chalk">{challenge.name}</p>
        <p className="mt-1 text-xs text-chalk/75">{challenge.tagline}</p>
        {challenge.complete ? (
          <span className="absolute top-3 right-3 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink uppercase">
            Complete
          </span>
        ) : null}
      </div>
      <div className="bg-black/25 px-4 py-3">
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="text-chalk/70">
            {challenge.owned} of {challenge.total} players
          </span>
          <span className="font-mono text-chalk/45">{percent}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full" style={{ width: `${percent}%`, background: 'var(--color-gold)' }} />
        </div>
        <p className="mt-2 text-[11px] text-chalk/45">
          {challenge.rewardClaimed ? 'Reward claimed' : `${challenge.rewardPacks} packs on completion`} ·
          <span className="ml-1 text-gold/80 group-hover:underline"> open the lineup</span>
        </p>
      </div>
    </motion.button>
  );
}

function ChallengeDetail({
  challengeId,
  onClose,
  window,
}: {
  challengeId: string;
  onClose: () => void;
  window: number;
}) {
  const challenges = useLoad(() => api.challenges(), [challengeId]);
  const challenge = useMemo(() => challenges.data?.challenges.find((c) => c.id === challengeId) ?? null, [challenges.data, challengeId]);
  const claim = useAction(async (id: string) => {
    await api.claimChallenge(id);
    challenges.reload();
  });

  if (!challenge) return null;

  const fielders = challenge.players.filter((p) => p.position !== 'SP' && p.position !== 'RP');
  const pitchers = challenge.players.filter((p) => p.position === 'SP' || p.position === 'RP');
  const missing = challenge.total - challenge.owned;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="panel w-full max-w-3xl p-4 sm:p-6"
        initial={{ y: 24, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold text-chalk">{challenge.name}</h2>
            <p className="text-sm text-chalk/60">{challenge.tagline}</p>
            <p className="mt-1 text-xs text-chalk/45">
              A card counts when its back covers {challenge.year}: any {challenge.year + 1}–{challenge.year + window} card of the
              player.
            </p>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div className="grid gap-5 sm:grid-cols-[1fr_1fr]">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-chalk/55 uppercase">The lineup</p>
            <ul className="divide-y divide-white/10">
              {fielders.map((player) => (
                <PlayerRow key={player.bbrefId} player={player} />
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-chalk/55 uppercase">The staff</p>
            <ul className="divide-y divide-white/10">
              {pitchers.map((player) => (
                <PlayerRow key={player.bbrefId} player={player} />
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-5 border-t border-white/10 pt-4">
          {challenge.complete ? (
            challenge.rewardClaimed ? (
              <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
                Collection complete — your {challenge.rewardPacks} packs are on the shelf.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" disabled={claim.busy} onClick={() => void claim.execute(challenge.id)}>
                  {claim.busy ? 'Claiming…' : `Claim ${challenge.rewardPacks} packs`}
                </Button>
                <p className="text-sm text-gold">You collected them all.</p>
              </div>
            )
          ) : (
            <p className="text-sm text-chalk/55">
              {missing} player{missing === 1 ? '' : 's'} still to collect. Search the era in{' '}
              <Link className="text-gold underline" to="/search">
                card search
              </Link>
              , or win packs on the field.
            </p>
          )}
          <ErrorNote error={claim.error} />
        </div>
      </motion.div>
    </motion.div>
  );
}

function PlayerRow({ player }: { player: ChallengeView['players'][number] }) {
  return (
    <li className="flex items-baseline gap-2 py-1.5">
      <span className="w-8 shrink-0 font-mono text-xs text-chalk/45">{player.position}</span>
      <span className={`min-w-0 flex-1 truncate text-sm ${player.have ? 'text-chalk' : 'text-chalk/45'}`}>{player.name}</span>
      {player.have ? (
        <span className="shrink-0 font-mono text-xs text-gold">
          ✓ {player.cardYear}
        </span>
      ) : (
        <span className="shrink-0 font-mono text-xs text-chalk/30">—</span>
      )}
    </li>
  );
}

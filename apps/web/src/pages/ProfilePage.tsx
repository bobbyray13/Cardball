import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { faceLabel, rarityRank, rateCard } from '@cardball/shared';
import type { CardRating, CollectionCard, GameMode, PublicProfileView } from '@cardball/shared';
import { ApiError, api } from '../api.js';
import { BallCard } from '../components/BallCard.js';
import { CardZoom } from '../components/CardZoom.js';
import type { ZoomTarget } from '../components/CardZoom.js';
import { RarityBadge } from '../components/RarityBadge.js';
import { Button, EmptyState, ErrorNote, Panel, Spinner, useAction, useLoad } from '../components/ui.js';
import { useSession } from '../session.js';

const MODE_LABEL: Record<GameMode, string> = { remote: 'Remote', hotseat: 'Hotseat', bot: 'Vs. bot' };

export function ProfilePage() {
  const username = useParams().username ?? '';
  const { user, refresh } = useSession();
  const profile = useLoad(() => api.profile(username), [username]);
  const [zoom, setZoom] = useState<ZoomTarget | null>(null);

  const toggle = useAction(async (open: boolean) => {
    await api.updateMe({ publicProfile: open });
    await refresh();
    await profile.reload();
  });

  if (profile.loading && !profile.data) return <Spinner label="Opening the binder…" />;
  if (profile.error && !profile.data) {
    return (
      <EmptyState title="This profile would not load">
        <p className="mb-3">
          {profile.error instanceof ApiError ? profile.error.message : String(profile.error)}
        </p>
        <Link to="/">
          <Button>Back to the lobby</Button>
        </Link>
      </EmptyState>
    );
  }

  const data = (profile.data as { profile: PublicProfileView }).profile;
  const mine = user !== null && data.user.id === user.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-chalk">{data.user.displayName}</h1>
          <p className="mt-1 text-sm text-chalk/60">
            In the league since {new Date(data.user.joinedAt).toLocaleDateString()} ·{' '}
            {data.open ? 'Binder open to the league' : 'Binder closed'}
          </p>
        </div>
        {mine ? (
          <div className="text-right">
            <Button variant={data.open ? 'secondary' : 'primary'} disabled={toggle.busy} onClick={() => void toggle.execute(!data.open)}>
              {toggle.busy ? 'Turning the lock…' : data.open ? 'Close my binder' : 'Open my binder'}
            </Button>
            <p className="mt-1 max-w-64 text-xs text-chalk/50">
              Opening your binder shows your collection, your teams, and your finished games to every signed-in manager.
            </p>
          </div>
        ) : null}
      </div>

      <ErrorNote error={profile.error} />

      {!data.open ? (
        <EmptyState title="This manager keeps their binder closed">
          {mine ? 'Flip the switch above to show the league your collection, teams, and results.' : null}
        </EmptyState>
      ) : (
        <>
          <TeamsPanel teams={data.teams ?? []} />
          <GamesPanel games={data.games ?? []} />
          <CollectionPanel cards={data.collection ?? []} onZoom={setZoom} />
        </>
      )}

      <CardZoom target={zoom} onClose={() => setZoom(null)} />
    </div>
  );
}

function TeamsPanel({ teams }: { teams: NonNullable<PublicProfileView['teams']> }) {
  return (
    <Panel title="Teams" subtitle={teams.length === 0 ? 'None yet' : `${teams.length} on the card`}>
      {teams.length === 0 ? (
        <p className="text-sm text-chalk/55">No teams built yet.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-dugout-light px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: team.primaryColor ?? '#3c5a6e' }} />
                <span className="truncate font-medium text-chalk">{team.name}</span>
              </span>
              <span className="shrink-0 text-xs text-chalk/50">
                {team.size} · {team.hasLineup ? 'lineup set' : 'no lineup'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function GamesPanel({ games }: { games: NonNullable<PublicProfileView['games']> }) {
  return (
    <Panel title="Finished games" subtitle={games.length === 0 ? 'None yet' : `${games.length} in the books`} >
      {games.length === 0 ? (
        <p className="text-sm text-chalk/55">No finished games yet.</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {games.map((game) => (
            <li key={game.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link to={`/games/${game.id}`} className="min-w-0 flex-1 font-medium text-chalk hover:text-gold hover:underline">
                <span className="truncate">
                  {game.home.name} {game.home.score} – {game.away.score} {game.away.name}
                </span>
                <span className="block text-xs font-normal text-chalk/45">
                  {MODE_LABEL[game.mode]} · {new Date(game.finishedAt).toLocaleDateString()}
                </span>
              </Link>
              {game.won === null ? null : (
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${game.won ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
                  {game.won ? 'Won' : 'Lost'}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CollectionPanel({ cards, onZoom }: { cards: CollectionCard[]; onZoom: (target: ZoomTarget) => void }) {
  const byRarity = cards
    .map((entry) => ({ entry, rating: rateCard(entry.card) as CardRating }))
    .sort((a, b) => rarityRank(b.rating.rarity) - rarityRank(a.rating.rarity));
  return (
    <Panel title="Collection" subtitle={cards.length === 0 ? 'Empty binder' : `${cards.length} cards, rarest first`}>
      {cards.length === 0 ? (
        <p className="text-sm text-chalk/55">Nothing in the binder yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {byRarity.map(({ entry, rating }) => {
            return (
              <button
                key={entry.id}
                type="button"
                className="text-left transition-transform hover:-translate-y-1"
                onClick={() => onZoom({ card: entry.card, photoId: entry.photoId, rarity: faceLabel(rating.rarity), tier: rating.rarity })}
              >
                <BallCard card={entry.card} photoId={entry.photoId} rarity={faceLabel(rating.rarity)} tier={rating.rarity} />
                <div className="mt-2 flex items-center gap-1.5">
                  <RarityBadge rarity={rating.rarity} />
                  <p className="min-w-0 truncate text-xs text-chalk/55">
                    {entry.setLabel || 'Cardball'} {entry.card.cardYear}
                    {entry.quantity > 1 ? ` · ×${entry.quantity}` : ''}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

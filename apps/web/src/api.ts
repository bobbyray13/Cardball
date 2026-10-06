/**
 * Typed client for the Cardball REST API.
 *
 * Every call goes through `request`, which turns a non-2xx response into an
 * ApiError carrying the server's own message, so screens can show the reason
 * ("That invite code is invalid or already used") instead of "something failed".
 */
import type {
  CardSnapshot,
  ChatMessage,
  CollectionCard,
  DraftConfig,
  DraftListItem,
  DraftView,
  GameAction,
  GameListItem,
  GameView,
  HouseRules,
  InviteSummary,
  PersonDetail,
  PersonSummary,
  SavedLineup,
  SessionUser,
  TeamSummary,
  TeamView,
} from '@cardball/shared';
import type { GameState } from '@cardball/engine';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: isForm || body === undefined ? undefined : { 'content-type': 'application/json' },
    body: isForm ? (body as FormData) : body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    let message = res.statusText || 'Request failed';
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      /* non-JSON error body: keep the status text */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type GameRoom = GameView<GameState>;

export interface GameDetail {
  game: GameRoom;
  events: { seq: number; inning: number; half: 'top' | 'bottom'; kind: string; text: string }[];
  chat: ChatMessage[];
}

export const api = {
  // ---- accounts ----
  authStatus: () => request<{ needsSetup: boolean }>('GET', '/api/auth/status'),
  me: () => request<{ user: SessionUser | null }>('GET', '/api/auth/me'),
  register: (input: { email: string; password: string; displayName: string; inviteCode?: string }) =>
    request<{ user: SessionUser }>('POST', '/api/auth/register', input),
  login: (input: { email: string; password: string }) => request<{ user: SessionUser }>('POST', '/api/auth/login', input),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  users: () => request<{ users: { id: number; displayName: string }[] }>('GET', '/api/users'),

  // ---- invites (commissioner) ----
  invites: () => request<{ invites: InviteSummary[] }>('GET', '/api/invites'),
  createInvite: (days = 30) => request<{ code: string; expiresAt: string }>('POST', '/api/invites', { days }),
  deleteInvite: (code: string) => request<{ ok: true }>('DELETE', `/api/invites/${encodeURIComponent(code)}`),

  // ---- card database ----
  searchPeople: (q: string, limit = 25) =>
    request<{ people: PersonSummary[] }>('GET', `/api/people/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  person: (id: number) => request<{ person: PersonDetail; seasons: PersonDetail['seasons']; cardYears: { min: number; max: number } | null }>('GET', `/api/people/${id}`),
  previewCard: (personId: number, cardYear: number) =>
    request<{ card: CardSnapshot }>('GET', `/api/cards/preview?personId=${personId}&cardYear=${cardYear}`),

  // ---- collection ----
  collection: () => request<{ cards: CollectionCard[] }>('GET', '/api/collection'),
  addCard: (input: { personId: number; cardYear: number; setLabel?: string; photoId?: number | null; notes?: string; source?: 'photo' | 'database' | 'draft' }) =>
    request<{ card: CollectionCard }>('POST', '/api/collection', input),
  updateCard: (id: number, input: { photoId?: number | null; notes?: string | null; quantity?: number }) =>
    request<{ card: CollectionCard }>('PATCH', `/api/collection/${id}`, input),
  deleteCard: (id: number) => request<{ ok: true }>('DELETE', `/api/collection/${id}`),

  /** Uploads a card photo and returns its id. */
  uploadPhoto: async (file: File, size: { width: number; height: number }): Promise<{ photoId: number }> => {
    const form = new FormData();
    form.set('width', String(Math.round(size.width)));
    form.set('height', String(Math.round(size.height)));
    form.set('file', file);
    return request<{ photoId: number }>('POST', '/api/photos', form);
  },
  photoUrl: (photoId: number) => `/api/photos/${photoId}`,

  // ---- teams ----
  teams: () => request<{ teams: TeamSummary[] }>('GET', '/api/teams'),
  createTeam: (input: { name: string; primaryColor?: string | null }) => request<{ team: TeamView }>('POST', '/api/teams', input),
  team: (id: number) => request<{ team: TeamView }>('GET', `/api/teams/${id}`),
  updateTeam: (id: number, input: { name?: string; primaryColor?: string | null; lineup?: SavedLineup | null }) =>
    request<{ team: TeamView }>('PATCH', `/api/teams/${id}`, input),
  setRoster: (id: number, userCardIds: number[]) => request<{ team: TeamView }>('PUT', `/api/teams/${id}/roster`, { userCardIds }),
  autoLineup: (id: number) => request<{ team: TeamView }>('POST', `/api/teams/${id}/auto-lineup`),
  deleteTeam: (id: number) => request<{ ok: true }>('DELETE', `/api/teams/${id}`),

  // ---- games ----
  games: () => request<{ games: GameListItem[] }>('GET', '/api/games'),
  createGame: (input: { mode: 'remote' | 'hotseat' | 'bot'; regulationInnings: number; teamId: number; opponentTeamId?: number }) =>
    request<{ game: GameRoom }>('POST', '/api/games', input),
  game: (id: number) => request<GameDetail>('GET', `/api/games/${id}`),
  joinGame: (id: number, teamId: number) => request<{ game: GameRoom }>('POST', `/api/games/${id}/join`, { teamId }),
  action: (id: number, action: GameAction) => request<{ game: GameRoom; events: GameDetail['events'] }>('POST', `/api/games/${id}/actions`, { action }),
  chat: (id: number, body: string) => request<{ message: ChatMessage }>('POST', `/api/games/${id}/chat`, { body }),
  setDiscord: (id: number, url: string | null) => request<{ game: GameRoom }>('PUT', `/api/games/${id}/discord`, { url }),
  deleteGame: (id: number) => request<{ ok: true }>('DELETE', `/api/games/${id}`),

  // ---- drafts ----
  drafts: () => request<{ drafts: DraftListItem[] }>('GET', '/api/drafts'),
  createDraft: (input: DraftConfig) => request<{ draft: DraftView }>('POST', '/api/drafts', input),
  draft: (id: number) => request<{ draft: DraftView }>('GET', `/api/drafts/${id}`),
  joinDraft: (id: number) => request<{ draft: DraftView }>('POST', `/api/drafts/${id}/join`),
  startDraft: (id: number) => request<{ draft: DraftView }>('POST', `/api/drafts/${id}/start`),
  pickDraftCard: (id: number, cardId: string) => request<{ draft: DraftView }>('POST', `/api/drafts/${id}/pick`, { cardId }),
  deleteDraft: (id: number) => request<{ ok: true }>('DELETE', `/api/drafts/${id}`),

  // ---- league settings ----
  houseRules: () => request<{ rules: HouseRules }>('GET', '/api/settings/rules'),
  saveHouseRules: (rules: HouseRules) => request<{ rules: HouseRules }>('PUT', '/api/settings/rules', rules),
};

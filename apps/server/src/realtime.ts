import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import { gameActionSchema } from '@cardball/shared';
import { tokenFromCookieHeader, userFromToken } from './auth.js';
import type { AuthUser } from './auth.js';
import type { Ctx } from './context.js';
import { getDraft } from './draftService.js';
import { getGame, performAction, postChat } from './gameService.js';
import { getTournament } from './tournamentService.js';
import { HttpError } from './http.js';

type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: string }) => void;

const gameIdSchema = z.number().int().positive();

/**
 * Socket.IO carries live game updates and chat. Clients authenticate with
 * the same session cookie as the REST API, join a game room, and receive
 * `game:update` (state + new events) and `chat:message` broadcasts.
 */
export function attachRealtime(httpServer: HttpServer, ctx: Ctx): Server {
  const io = new Server(httpServer, { path: '/socket.io', serveClient: false });

  io.use(async (socket, next) => {
    const user = await userFromToken(ctx, tokenFromCookieHeader(socket.handshake.headers.cookie));
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  const presence = (gameId: number) => {
    const room = io.sockets.adapter.rooms.get(`game:${gameId}`);
    const names = new Map<number, string>();
    for (const id of room ?? []) {
      const u = io.sockets.sockets.get(id)?.data.user as AuthUser | undefined;
      if (u) names.set(u.id, u.displayName);
    }
    io.to(`game:${gameId}`).emit('game:presence', { gameId, users: [...names].map(([id, name]) => ({ id, name })) });
  };

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser;
    const run = async (ack: Ack | undefined, fn: () => Promise<unknown>) => {
      try {
        const data = await fn();
        ack?.({ ok: true, data });
      } catch (err) {
        const message = err instanceof HttpError || err instanceof z.ZodError ? err.message : 'Something went wrong';
        if (!(err instanceof HttpError)) console.error(err);
        ack?.({ ok: false, error: message });
      }
    };

    socket.on('game:join', (rawId: unknown, ack?: Ack) =>
      run(ack, async () => {
        const gameId = gameIdSchema.parse(rawId);
        const snapshot = await getGame(ctx, user, gameId);
        await socket.join(`game:${gameId}`);
        presence(gameId);
        return snapshot;
      }),
    );

    socket.on('game:leave', (rawId: unknown) => {
      const gameId = gameIdSchema.safeParse(rawId);
      if (!gameId.success) return;
      void Promise.resolve(socket.leave(`game:${gameId.data}`)).then(() => presence(gameId.data));
    });

    // Draft rooms broadcast a nudge; clients re-fetch the room over REST, which
    // keeps the pack logic in one place and out of the socket layer.
    socket.on('draft:join', (rawId: unknown, ack?: Ack) =>
      run(ack, async () => {
        const draftId = gameIdSchema.parse(rawId);
        const draft = await getDraft(ctx, user, draftId);
        await socket.join(`draft:${draftId}`);
        return draft;
      }),
    );

    socket.on('draft:leave', (rawId: unknown) => {
      const draftId = gameIdSchema.safeParse(rawId);
      if (!draftId.success) return;
      void Promise.resolve(socket.leave(`draft:${draftId.data}`));
    });

    // Tournament rooms work the same way: a nudge, then a REST re-fetch.
    socket.on('tournament:join', (rawId: unknown, ack?: Ack) =>
      run(ack, async () => {
        const tournamentId = gameIdSchema.parse(rawId);
        const tournament = await getTournament(ctx, user, tournamentId);
        await socket.join(`tournament:${tournamentId}`);
        return tournament;
      }),
    );

    socket.on('tournament:leave', (rawId: unknown) => {
      const tournamentId = gameIdSchema.safeParse(rawId);
      if (!tournamentId.success) return;
      void Promise.resolve(socket.leave(`tournament:${tournamentId.data}`));
    });

    socket.on('game:action', (payload: unknown, ack?: Ack) =>
      run(ack, async () => {
        const { gameId, action } = z.object({ gameId: gameIdSchema, action: gameActionSchema }).parse(payload);
        // Broadcast covers everyone in the room, including this socket.
        await performAction(ctx, user, gameId, action);
        return null;
      }),
    );

    socket.on('chat:send', (payload: unknown, ack?: Ack) =>
      run(ack, async () => {
        const { gameId, body } = z.object({ gameId: gameIdSchema, body: z.string().max(500) }).parse(payload);
        return postChat(ctx, user, gameId, body);
      }),
    );

    socket.on('disconnecting', () => {
      const rooms = [...socket.rooms].filter((r) => r.startsWith('game:'));
      setImmediate(() => rooms.forEach((r) => presence(Number(r.slice(5)))));
    });
  });

  return io;
}

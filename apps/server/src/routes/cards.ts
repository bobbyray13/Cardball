import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cardModels, people, photos, seasonRowToStats, seasons, userCards } from '@cardball/db';
import { requireUser } from '../auth.js';
import { buildCard, validCardYears } from '../cards.js';
import { loadCollection, loadUserCards } from '../collection.js';
import type { Ctx } from '../context.js';
import { env } from '../env.js';
import { badRequest, idParam, notFound, parse } from '../http.js';

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const addCardSchema = z.object({
  personId: z.number().int().positive(),
  cardYear: z.number().int().min(1872).max(2100),
  setLabel: z.string().trim().max(80).default(''),
  rarity: z.string().trim().max(40).nullish(),
  photoId: z.number().int().positive().nullish(),
  notes: z.string().trim().max(500).nullish(),
  source: z.enum(['photo', 'database', 'draft']).default('database'),
});

const updateCardSchema = z.object({
  photoId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  quantity: z.number().int().min(1).max(99).optional(),
});

async function loadPerson(ctx: Ctx, personId: number) {
  const [person] = await ctx.db.select().from(people).where(eq(people.id, personId)).limit(1);
  if (!person) throw notFound('Player not found');
  return person;
}

/** Find or create the catalog card for player + year + set. */
export async function ensureCardModel(
  ctx: Ctx,
  input: { personId: number; cardYear: number; setLabel: string; rarity?: string | null; source: string; userId: number },
): Promise<number> {
  const [existing] = await ctx.db
    .select({ id: cardModels.id })
    .from(cardModels)
    .where(and(eq(cardModels.personId, input.personId), eq(cardModels.cardYear, input.cardYear), eq(cardModels.setLabel, input.setLabel)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await ctx.db
    .insert(cardModels)
    .values({
      personId: input.personId,
      cardYear: input.cardYear,
      setLabel: input.setLabel,
      rarity: input.rarity ?? null,
      source: input.source,
      createdByUserId: input.userId,
    })
    .onConflictDoNothing()
    .returning({ id: cardModels.id });
  if (created) return created.id;
  // Lost a race with a concurrent insert: read it back.
  return ensureCardModel(ctx, input);
}

export function cardRoutes(app: FastifyInstance, ctx: Ctx): void {
  // ---- player database ----

  app.get('/api/people/search', async (request) => {
    requireUser(request);
    const q = parse(
      z.object({ q: z.string().trim().min(2).max(60), limit: z.coerce.number().int().min(1).max(50).default(25) }),
      request.query,
    );
    const terms = q.q.split(/\s+/).filter(Boolean);
    const fullName = sql`${people.nameFirst} || ' ' || ${people.nameLast}`;
    const conditions = terms.map((t) => or(ilike(fullName, `%${t}%`), ilike(people.nameGiven, `%${t}%`)));
    const rows = await ctx.db
      .select({
        id: people.id,
        nameFirst: people.nameFirst,
        nameLast: people.nameLast,
        debutYear: people.debutYear,
        finalYear: people.finalYear,
        isStarter: people.isStarter,
        primaryPosition: sql<string | null>`(
          select ${seasons.primaryPosition} from ${seasons}
          where ${seasons.personId} = ${people.id} and ${seasons.primaryPosition} is not null
          group by ${seasons.primaryPosition} order by sum(${seasons.games}) desc limit 1)`,
      })
      .from(people)
      .where(and(...conditions))
      // Longer careers first: the famous player usually beats the cup-of-coffee namesake.
      .orderBy(sql`coalesce(${people.finalYear} - ${people.debutYear}, 0) desc`, asc(people.nameLast))
      .limit(q.limit);
    return { people: rows };
  });

  app.get('/api/people/:id', async (request) => {
    requireUser(request);
    const person = await loadPerson(ctx, idParam(request.params));
    const rows = await ctx.db.select().from(seasons).where(eq(seasons.personId, person.id)).orderBy(seasons.year);
    return { person, seasons: rows.map(seasonRowToStats), cardYears: validCardYears(person) };
  });

  app.get('/api/cards/preview', async (request) => {
    requireUser(request);
    const q = parse(z.object({ personId: z.coerce.number().int(), cardYear: z.coerce.number().int() }), request.query);
    const person = await loadPerson(ctx, q.personId);
    const rows = await ctx.db.select().from(seasons).where(eq(seasons.personId, person.id));
    return { card: buildCard(person, rows, q.cardYear) };
  });

  // ---- collection ----

  app.get('/api/collection', async (request) => {
    const user = requireUser(request);
    return { cards: await loadCollection(ctx, user.id) };
  });

  app.post('/api/collection', async (request) => {
    const user = requireUser(request);
    const body = parse(addCardSchema, request.body);
    const person = await loadPerson(ctx, body.personId);
    const years = validCardYears(person);
    if (!years || body.cardYear < years.min || body.cardYear > years.max) {
      throw badRequest(years ? `Card year must be ${years.min}–${years.max} for this player` : 'No career data for this player');
    }
    if (body.photoId) await assertOwnPhoto(ctx, user.id, body.photoId);

    const cardModelId = await ensureCardModel(ctx, { ...body, userId: user.id });
    const [row] = await ctx.db
      .insert(userCards)
      .values({ userId: user.id, cardModelId, photoId: body.photoId ?? null, notes: body.notes ?? null })
      .returning({ id: userCards.id });
    const [card] = await loadUserCards(ctx, user.id, [row!.id]);
    return { card };
  });

  app.patch('/api/collection/:id', async (request) => {
    const user = requireUser(request);
    const id = idParam(request.params);
    const body = parse(updateCardSchema, request.body);
    if (body.photoId) await assertOwnPhoto(ctx, user.id, body.photoId);
    const updated = await ctx.db
      .update(userCards)
      .set(body)
      .where(and(eq(userCards.id, id), eq(userCards.userId, user.id)))
      .returning({ id: userCards.id });
    if (updated.length === 0) throw notFound('Card not found');
    const [card] = await loadUserCards(ctx, user.id, [id]);
    return { card };
  });

  app.delete('/api/collection/:id', async (request) => {
    const user = requireUser(request);
    const id = idParam(request.params);
    await ctx.db.delete(userCards).where(and(eq(userCards.id, id), eq(userCards.userId, user.id)));
    return { ok: true };
  });

  // ---- photos ----

  app.post('/api/photos', async (request) => {
    const user = requireUser(request);
    const file = await request.file({ limits: { fileSize: env.maxUploadBytes, files: 1 } });
    if (!file) throw badRequest('No file uploaded');
    const ext = MIME_EXT[file.mimetype];
    if (!ext) throw badRequest('Photos must be JPEG, PNG, or WebP');

    await mkdir(env.uploadDir, { recursive: true });
    const fileName = `${randomBytes(16).toString('hex')}.${ext}`;
    const path = join(env.uploadDir, fileName);
    await pipeline(file.file, createWriteStream(path));
    if (file.file.truncated) {
      await unlink(path);
      throw badRequest('Photo is too large (8 MB max)');
    }

    const fields = file.fields as Record<string, { value?: string } | undefined>;
    const width = Number(fields.width?.value ?? 0) || 0;
    const height = Number(fields.height?.value ?? 0) || 0;
    const { size } = await stat(path);
    const [photo] = await ctx.db
      .insert(photos)
      .values({ ownerId: user.id, fileName, mime: file.mimetype, width, height, sizeBytes: size })
      .returning({ id: photos.id });
    return { photoId: photo!.id };
  });

  // Photos are visible to any signed-in member so opponents see your real card in games.
  app.get('/api/photos/:id', async (request, reply) => {
    requireUser(request);
    const [photo] = await ctx.db.select().from(photos).where(eq(photos.id, idParam(request.params))).limit(1);
    if (!photo) throw notFound('Photo not found');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    reply.type(photo.mime);
    return reply.send(createReadStream(join(env.uploadDir, photo.fileName)));
  });
}

async function assertOwnPhoto(ctx: Ctx, userId: number, photoId: number): Promise<void> {
  const [photo] = await ctx.db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.ownerId, userId)))
    .limit(1);
  if (!photo) throw badRequest('Unknown photo');
}

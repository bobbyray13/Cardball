import type { ZodTypeAny, output } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (what = 'Not allowed') => new HttpError(403, what);
export const badRequest = (what: string) => new HttpError(400, what);

/** Parse request input with zod, turning failures into a 400 with a readable message. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw badRequest(`${path}${issue?.message ?? 'Invalid input'}`);
  }
  return result.data;
}

export function idParam(params: unknown): number {
  const id = Number((params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Invalid id');
  return id;
}

import { z } from "zod";

/** An error whose message is safe to show the client. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, init);
}

/** Parse `request.url` query params through a zod schema; invalid input becomes a 400. */
export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.output<S> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const result = schema.safeParse(params);
  if (!result.success) throw new ApiError(400, "Invalid query parameters", z.flattenError(result.error));
  return result.data;
}

/** Parse a JSON body through a zod schema; malformed JSON or invalid fields become a 400. */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError(400, "Invalid request body", z.flattenError(result.error));
  return result.data;
}

/**
 * Wraps a route handler: ApiErrors map to their status, anything unexpected is logged
 * server-side and returned as a generic 500 (never leaking SQL or file paths).
 */
export function handle(fn: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: err.message, details: err.details }, { status: err.status });
      }
      console.error(`${request.method} ${new URL(request.url).pathname} failed:`, err);
      return json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

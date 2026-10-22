import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ApiError, handle, parseBody, parseQuery } from "./http";

const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);

test("parseQuery coerces valid params and rejects invalid ones with details", () => {
  const schema = z.object({ n: z.coerce.number().int().min(1).max(10).default(5) });
  assert.deepEqual(parseQuery(req("/x?n=3"), schema), { n: 3 });
  assert.deepEqual(parseQuery(req("/x"), schema), { n: 5 });
  assert.throws(() => parseQuery(req("/x?n=99"), schema), (e) => e instanceof ApiError && e.status === 400);
});

test("parseBody handles malformed JSON and schema errors", async () => {
  const schema = z.object({ a: z.number() });
  assert.deepEqual(await parseBody(req("/x", { method: "POST", body: '{"a":1}' }), schema), { a: 1 });
  await assert.rejects(parseBody(req("/x", { method: "POST", body: "{nope" }), schema), /valid JSON/);
  await assert.rejects(parseBody(req("/x", { method: "POST", body: '{"a":"x"}' }), schema), /Invalid request body/);
});

test("handle maps ApiError to its status and hides unexpected errors", async () => {
  const bad = await handle(async () => { throw new ApiError(404, "nope"); })(req("/x"));
  assert.equal(bad.status, 404);
  assert.equal((await bad.json()).error, "nope");

  const log = console.error;
  console.error = () => {};
  try {
    const boom = await handle(async () => { throw new Error('password authentication failed for user "urbanheat_ro"'); })(req("/x"));
    assert.equal(boom.status, 500);
    const body = await boom.json();
    assert.deepEqual(body, { error: "Internal server error" });
  } finally {
    console.error = log;
  }
  assert.equal((await handle(async () => Response.json({ ok: 1 }))(req("/x"))).status, 200);
});

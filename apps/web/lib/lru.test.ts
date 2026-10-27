import { test } from "node:test";
import assert from "node:assert/strict";
import { LruCache } from "./lru";

test("evicts the least recently used entry", () => {
  const c = new LruCache<number>(2);
  c.set("a", 1);
  c.set("b", 2);
  assert.equal(c.get("a"), 1); // a is now most recent
  c.set("c", 3); // evicts b
  assert.equal(c.get("b"), undefined);
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("c"), 3);
  assert.equal(c.size, 2);
});

test("overwriting refreshes recency without growing", () => {
  const c = new LruCache<string>(2);
  c.set("a", "1");
  c.set("b", "2");
  c.set("a", "1b"); // a most recent
  c.set("c", "3"); // evicts b
  assert.deepEqual([c.get("a"), c.get("b"), c.get("c")], ["1b", undefined, "3"]);
});

test("rejects a nonsensical size", () => {
  assert.throws(() => new LruCache(0), RangeError);
  assert.throws(() => new LruCache(1.5), RangeError);
});

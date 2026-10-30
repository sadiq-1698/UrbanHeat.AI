import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYER_ORDER, type OurLayerId, beforeLayerFor } from "./layer-order";

/** A fake map whose layer stack we can inspect; `addLayer` honours `before` like MapLibre does. */
function fakeMap(base: { id: string; type: string }[]) {
  const stack = [...base];
  return {
    stack,
    getLayer: (id: string) => stack.find((l) => l.id === id),
    getStyle: () => ({ layers: stack }),
    add(id: OurLayerId) {
      const before = beforeLayerFor(this, id);
      const at = before ? stack.findIndex((l) => l.id === before) : stack.length;
      stack.splice(at, 0, { id, type: "x" });
    },
  };
}
const BASE = [{ id: "water", type: "fill" }, { id: "roads", type: "line" }, { id: "place-labels", type: "symbol" }, { id: "poi-labels", type: "symbol" }];

test("whatever order layers are added in, the final stack is the same and sits as intended", () => {
  const orders: OurLayerId[][] = [
    [...LAYER_ORDER],
    [...LAYER_ORDER].reverse(),
    ["stations-circle", "raster-overlay", "temperature-surface", "land-cover-fill", "station-heatmap", "stations-label", "land-cover-line"],
  ];
  const results = orders.map((o) => {
    const m = fakeMap(BASE);
    o.forEach((id) => m.add(id));
    return m.stack.map((l) => l.id);
  });
  for (const r of results) assert.deepEqual(r, results[0]);
  const final = results[0]!;
  assert.deepEqual(final.filter((id) => (LAYER_ORDER as readonly string[]).includes(id)), [...LAYER_ORDER]);
  // everything but the station layers is below the first label; stations are above all labels
  const firstLabel = final.indexOf("place-labels");
  for (const id of LAYER_ORDER) {
    const above = id === "stations-circle" || id === "stations-label";
    assert.equal(final.indexOf(id) > firstLabel, above, id);
  }
});

test("a basemap without labels (offline fallback) still works", () => {
  const m = fakeMap([{ id: "background", type: "background" }]);
  for (const id of [...LAYER_ORDER].reverse()) m.add(id);
  assert.deepEqual(m.stack.map((l) => l.id), ["background", ...LAYER_ORDER]);
});

test("the topmost layers have nothing above them", () => {
  const m = fakeMap(BASE);
  assert.equal(beforeLayerFor(m, "stations-label"), undefined);
  assert.equal(beforeLayerFor(m, "stations-circle"), undefined);
  assert.equal(beforeLayerFor(m, "raster-overlay"), "place-labels");
});

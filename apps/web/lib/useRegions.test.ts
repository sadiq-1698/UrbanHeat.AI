import { test } from "node:test";
import assert from "node:assert/strict";
import { regionsFromLayers } from "./useRegions";

test("groups catalog rows by region and unions their bboxes", () => {
  const regions = regionsFromLayers([
    { region: "b", bbox: [0, 0, 1, 1] },
    { region: "a", bbox: [10, 10, 11, 11] },
    { region: "b", bbox: [-1, 0.5, 0.5, 2] },
  ]);
  assert.deepEqual(regions.map((r) => r.id), ["a", "b"]);
  assert.deepEqual(regions[1], { id: "b", bbox: [-1, 0, 1, 2], layerCount: 2 });
  assert.deepEqual(regionsFromLayers([]), []);
});

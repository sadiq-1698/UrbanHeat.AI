import { test } from "node:test";
import assert from "node:assert/strict";
import { LAND_COVER_CLASSES } from "../queries/landcover";
import { FALLBACK_COLOR, LAND_COVER_ORDER, LAND_COVER_STYLES, classLabel, colorExpression, formatArea, landCoverUrl, popupRows, simplifyTolerance, zoomBucket } from "./landcover";

test("every API land cover class has a style, and nothing extra", () => {
  assert.deepEqual([...LAND_COVER_ORDER].sort(), [...LAND_COVER_CLASSES].sort());
  for (const c of LAND_COVER_ORDER) assert.match(LAND_COVER_STYLES[c].color, /^#[0-9a-f]{6}$/);
  assert.equal(new Set(LAND_COVER_ORDER.map((c) => LAND_COVER_STYLES[c].color)).size, LAND_COVER_ORDER.length, "colors are distinct");
});

test("colorExpression is a well-formed match with a fallback", () => {
  const e = colorExpression();
  assert.equal(e[0], "match");
  assert.deepEqual(e[1], ["get", "class"]);
  assert.equal(e.at(-1), FALLBACK_COLOR);
  assert.equal((e.length - 3) % 2, 0); // label/color pairs between the input and the fallback
  assert.equal(e[2], "developed_high");
  assert.equal(e[3], LAND_COVER_STYLES.developed_high.color);
});

test("simplifyTolerance shrinks with zoom, vanishes when fine, and respects the API cap", () => {
  assert.ok(simplifyTolerance(8) > simplifyTolerance(10));
  assert.ok(simplifyTolerance(10) > simplifyTolerance(12));
  assert.equal(simplifyTolerance(16), 0);
  assert.equal(simplifyTolerance(0), 0.1); // world view: capped at the API maximum
  for (let z = -2; z <= 22; z += 0.5) {
    const t = simplifyTolerance(z);
    assert.ok(t >= 0 && t <= 0.1, `z=${z} -> ${t}`);
  }
});

test("landCoverUrl builds a valid API request", () => {
  const u = new URL(landCoverUrl({ bbox: [-122.55, 47.55, -122.35, 47.7], region: "demo-city", zoom: 11 }), "http://x");
  assert.equal(u.pathname, "/api/landcover");
  assert.equal(u.searchParams.get("bbox"), "-122.55,47.55,-122.35,47.7");
  assert.equal(u.searchParams.get("region"), "demo-city");
  assert.equal(u.searchParams.get("limit"), "2000");
  const s = u.searchParams.get("simplify")!;
  assert.match(s, /^\d+\.\d{6}$/); // plain decimal, never 1e-5
  assert.ok(Number(s) > 0 && Number(s) <= 0.1);
  const exact = new URL(landCoverUrl({ bbox: [0, 0, 1, 1], region: "r", zoom: 17 }), "http://x");
  assert.equal(exact.searchParams.has("simplify"), false);
});

test("zoomBucket", () => {
  assert.equal(zoomBucket(11.9), 11);
  assert.equal(zoomBucket(-3), 0);
});

test("formatArea picks a sensible unit", () => {
  assert.equal(formatArea(820), "820 m²");
  assert.equal(formatArea(45_000), "4.5 ha");
  assert.equal(formatArea(450_000), "45 ha");
  assert.equal(formatArea(3_200_000), "3.2 km²");
  assert.equal(formatArea(25_000_000), "25 km²");
  assert.equal(formatArea(null), "—");
  assert.equal(formatArea(NaN), "—");
});

test("popupRows tolerates missing or odd values", () => {
  const full = popupRows({ class: "forest", canopy_pct: 71.234, impervious_pct: 4, area_m2: 3_200_000 });
  assert.equal(full.title, "Forest");
  assert.deepEqual(full.rows.map((r) => r.value), ["71.2%", "4.0%", "3.2 km²"]);
  const odd = popupRows({ class: "lava", canopy_pct: null, area_m2: "x" });
  assert.equal(odd.title, "lava");
  assert.deepEqual(odd.rows.map((r) => r.value), ["—", "—", "—"]);
  assert.equal(classLabel("water"), "Open water");
});

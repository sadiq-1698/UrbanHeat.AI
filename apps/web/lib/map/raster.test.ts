import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultKind, formatDomainValue, kindLabel, legendGradient, sortKinds, tileUrlTemplate } from "./raster";

test("kinds are labelled and sorted, with temperature first and unknown kinds last", () => {
  assert.deepEqual(sortKinds(["elevation", "zeta", "canopy", "lst", "alpha", "impervious"]), ["lst", "canopy", "impervious", "elevation", "alpha", "zeta"]);
  assert.equal(defaultKind(["canopy", "lst"]), "lst");
  assert.equal(defaultKind(["impervious", "canopy"]), "canopy");
  assert.equal(defaultKind([]), undefined);
  assert.equal(kindLabel("lst"), "Surface temperature");
  assert.equal(kindLabel("ndvi"), "ndvi");
});

test("tileUrlTemplate keeps the {z}/{x}/{y} placeholders and escapes segments", () => {
  assert.equal(tileUrlTemplate("http://h:3000", "demo-city", "lst"), "http://h:3000/api/raster/tile/demo-city/lst/{z}/{x}/{y}.png");
  assert.match(tileUrlTemplate("http://h", "a b", "c/d"), /a%20b\/c%2Fd\/\{z\}/);
});

test("legendGradient positions stops by value and keeps alpha", () => {
  const g = legendGradient([{ value: 0, color: "#ff0000", alpha: 0 }, { value: 50, color: "#00ff00", alpha: 0.5 }, { value: 100, color: "#0000ff", alpha: 1 }], [0, 100]);
  assert.equal(g, "linear-gradient(to right, rgba(255, 0, 0, 0) 0.0%, rgba(0, 255, 0, 0.5) 50.0%, rgba(0, 0, 255, 1) 100.0%)");
  const shifted = legendGradient([{ value: 20, color: "#000000", alpha: 1 }, { value: 40, color: "#ffffff", alpha: 1 }], [20, 40]);
  assert.match(shifted, /0\.0%.*100\.0%/);
  assert.doesNotThrow(() => legendGradient([{ value: 5, color: "#000000", alpha: 1 }], [5, 5])); // degenerate domain
});

test("formatDomainValue uses the unit", () => {
  assert.equal(formatDomainValue(0, "percent"), "0%");
  assert.equal(formatDomainValue(21, "celsius"), "21 °C");
  assert.equal(formatDomainValue(12.34, "meters"), "12.3 m");
  assert.equal(formatDomainValue(3, "ppm"), "3 ppm");
});

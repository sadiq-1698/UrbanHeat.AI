import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { bboxParam, pointParam, regionParam } from "./schemas";

test("bboxParam parses and validates", () => {
  assert.deepEqual(bboxParam.parse("-122.55, 47.55,-122.35,47.7"), [-122.55, 47.55, -122.35, 47.7]);
  for (const bad of ["1,2,3", "a,b,c,d", "1,2,3,4,5", "5,0,1,1", "0,5,1,1", "-200,0,1,1", "0,0,1,95", "", "1,2,3,NaN"]) {
    assert.equal(bboxParam.safeParse(bad).success, false, bad);
  }
});

test("pointParam parses and validates", () => {
  assert.deepEqual(pointParam.parse("-122.4,47.6"), [-122.4, 47.6]);
  for (const bad of ["1", "1,2,3", "x,y", "181,0", "0,91"]) assert.equal(pointParam.safeParse(bad).success, false, bad);
});

test("regionParam only allows slugs", () => {
  assert.equal(regionParam.parse("demo-city"), "demo-city");
  for (const bad of ["", "a b", "x'; drop table land_cover;--", "../etc", "-lead"]) {
    assert.equal(regionParam.safeParse(bad).success, false, bad);
  }
});

test("error messages are readable", () => {
  const r = z.object({ bbox: bboxParam }).safeParse({ bbox: "5,0,1,1" });
  assert.ok(!r.success && /west < east/.test(r.error.issues[0]!.message));
});

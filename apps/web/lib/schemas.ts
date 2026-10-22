import { z } from "zod";

/** "west,south,east,north" in degrees -> tuple, validated. */
export const bboxParam = z
  .string()
  .transform((s, ctx) => {
    const parts = s.split(",").map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({ code: "custom", message: "bbox must be four numbers: west,south,east,north" });
      return z.NEVER;
    }
    return parts as [number, number, number, number];
  })
  .refine(([w, s, e, n]) => w >= -180 && e <= 180 && s >= -90 && n <= 90, "bbox out of range (lon ±180, lat ±90)")
  .refine(([w, s, e, n]) => w < e && s < n, "bbox must satisfy west < east and south < north");

/** "lon,lat" -> tuple, validated. */
export const pointParam = z
  .string()
  .transform((s, ctx) => {
    const parts = s.split(",").map((p) => Number(p.trim()));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
      ctx.addIssue({ code: "custom", message: "point must be two numbers: lon,lat" });
      return z.NEVER;
    }
    return parts as [number, number];
  })
  .refine(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90, "point out of range (lon ±180, lat ±90)");

/** Region labels are free text in the DB; restrict to a safe slug alphabet at the API edge. */
export const regionParam = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, "region must be a short slug (letters, digits, - _)");

export const RASTER_KINDS = ["canopy", "impervious", "lst", "elevation"] as const;
export type RasterKind = (typeof RASTER_KINDS)[number];

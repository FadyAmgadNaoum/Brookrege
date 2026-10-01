/** Media rules shared by API (processing) and frontends (srcset). */
export const IMAGE_WIDTHS = [480, 960, 1600] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Cloudflare (Free/Pro) rejects request bodies over 100 MB, so videos stay under that. */
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 20;

export type MediaKind = "IMAGE" | "VIDEO";
/** Variant URLs keyed by width, e.g. { "480": "https://…/480.webp" }. */
export type Variants = Partial<Record<`${ImageWidth}`, string>>;

/** Only generate widths that are not larger than the original (never upscale). */
export function widthsFor(originalWidth: number): ImageWidth[] {
  const fit = IMAGE_WIDTHS.filter((w) => w <= originalWidth);
  return fit.length ? fit : [IMAGE_WIDTHS[0]];
}

export function srcSet(variants: Variants | null | undefined): string | undefined {
  if (!variants) return undefined;
  const parts = IMAGE_WIDTHS.filter((w) => variants[`${w}`]).map((w) => `${variants[`${w}`]} ${w}w`);
  return parts.length ? parts.join(", ") : undefined;
}

/** Smallest variant at least `minWidth` wide, else the largest available. */
export function pickVariant(variants: Variants | null | undefined, minWidth: number): string | undefined {
  if (!variants) return undefined;
  const available = IMAGE_WIDTHS.filter((w) => variants[`${w}`]);
  const w = available.find((x) => x >= minWidth) ?? available[available.length - 1];
  return w ? variants[`${w}`] : undefined;
}

/**
 * Media expiration strategy:
 * - Deleted assets are kept 30 days (undo window, audit), then removed from storage.
 * - Uploads never attached to anything are treated as abandoned after 7 days.
 * - Media of EXPIRED listings is kept: listings can be renewed at any time.
 */
export const PURGE_DELETED_AFTER_DAYS = 30;
export const ABANDONED_UPLOAD_AFTER_DAYS = 7;

export function mediaLifecycle(a: { deletedAt: Date | null; createdAt: Date; usageCount: number }, now = new Date()): "keep" | "soft_delete" | "purge" {
  const days = (d: Date) => (now.getTime() - d.getTime()) / 86_400_000;
  if (a.deletedAt) return days(a.deletedAt) >= PURGE_DELETED_AFTER_DAYS ? "purge" : "keep";
  if (a.usageCount === 0 && days(a.createdAt) >= ABANDONED_UPLOAD_AFTER_DAYS) return "soft_delete";
  return "keep";
}

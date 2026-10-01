import sharp from "sharp";
import { widthsFor, type ImageWidth } from "@brookrege/domain";

sharp.concurrency(2); // leave CPU for web requests
sharp.cache(false);

export interface ProcessedImage { width: number; height: number; variants: { width: ImageWidth; buffer: Buffer }[] }

/**
 * Resizes to 480/960/1600 px WebP (never upscaling). Sharp drops EXIF metadata by default —
 * important for privacy: phone photos carry GPS coordinates of the owner's home.
 * `.rotate()` applies the EXIF orientation first so portrait photos aren't sideways.
 */
export async function processImage(input: Buffer | string): Promise<ProcessedImage> {
  const base = sharp(input, { failOn: "error", limitInputPixels: 60_000_000 }).rotate();
  const meta = await base.metadata();
  const upright = meta.orientation && meta.orientation >= 5; // 90° rotations swap width/height
  const width = (upright ? meta.height : meta.width) ?? 0;
  const height = (upright ? meta.width : meta.height) ?? 0;
  if (!width || !height) throw new Error("Could not read the image size.");
  const variants = await Promise.all(
    widthsFor(width).map(async (w) => ({ width: w, buffer: await base.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer() })),
  );
  return { width, height, variants };
}

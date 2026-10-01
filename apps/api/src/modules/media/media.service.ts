import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createReadStream } from "node:fs";
import type { MediaAsset, Prisma } from "@prisma/client";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, mediaLifecycle, type Variants } from "@brookrege/domain";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { storage, IMMUTABLE } from "../../storage/storage";
import { enqueue } from "../jobs/queue";
import { processImage } from "./imagePipeline";
import { sniff } from "./sniff";
import { invalidatePublic } from "../../lib/appCache";

export interface IncomingFile { path: string; originalname: string; size: number }
export type UploadResult = { ok: true; asset: MediaAsset } | { ok: false; file: string; message: string };

const newKey = () => {
  const d = new Date();
  return `media/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
};

async function readHead(file: string) {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(32);
    await fh.read(buf, 0, 32, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

/** Stores one uploaded file as a library asset. Never throws for a bad file — returns a per-file error (bulk uploads continue). */
export async function ingest(file: IncomingFile, uploadedById: string | null): Promise<UploadResult> {
  // File names come from the uploader's computer: strip control characters (incl. NUL, which PostgreSQL rejects).
  const name = file.originalname.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || "file";
  try {
    const type = sniff(await readHead(file.path));
    if (type.kind === "UNSUPPORTED") return { ok: false, file: name, message: type.reason };

    if (type.kind === "IMAGE") {
      if (file.size > MAX_IMAGE_BYTES) return { ok: false, file: name, message: "Images must be 15 MB or smaller." };
      const img = await processImage(await readFile(file.path));
      const key = newKey();
      const variants: Variants = {};
      for (const v of img.variants) variants[`${v.width}`] = await storage.put(`${key}/${v.width}.webp`, v.buffer, "image/webp", IMMUTABLE);
      const largest = img.variants[img.variants.length - 1]!;
      const asset = await prisma.mediaAsset.create({
        data: {
          kind: "IMAGE", status: "READY", storageKey: key, url: variants[`${largest.width}`]!, variants: variants as Prisma.InputJsonObject,
          mimeType: "image/webp", bytes: img.variants.reduce((n, v) => n + v.buffer.length, 0), width: img.width, height: img.height,
          originalName: name, uploadedById,
        },
      });
      return { ok: true, asset };
    }

    // Video: store the original now; the poster frame and duration are produced by a background job.
    if (file.size > MAX_VIDEO_BYTES) return { ok: false, file: name, message: "Videos must be 95 MB or smaller (about one minute of 1080p)." };
    const key = newKey();
    const url = await storage.put(`${key}/video.${type.ext}`, createReadStream(file.path), type.mime, IMMUTABLE);
    const asset = await prisma.$transaction(async (tx) => {
      const a = await tx.mediaAsset.create({
        data: { kind: "VIDEO", status: "PROCESSING", storageKey: key, url, mimeType: type.mime, bytes: file.size, originalName: name, uploadedById },
      });
      await enqueue("video_thumbnail", { assetId: a.id, file: `${key}/video.${type.ext}` }, { db: tx, maxAttempts: 3 });
      return a;
    });
    return { ok: true, asset };
  } catch (err) {
    logger.warn("media_ingest_failed", { file: name, message: (err as Error).message });
    return { ok: false, file: name, message: "This file couldn't be processed. It may be damaged." };
  } finally {
    await rm(file.path, { force: true }).catch(() => undefined);
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });
}

/** Background job: read duration/size with ffprobe, grab a frame with ffmpeg, publish it as WebP poster variants. */
export async function makeVideoThumbnail(assetId: string, fileKey: string) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.deletedAt) return;
  const dir = await mkdtemp(path.join(tmpdir(), "bk-video-"));
  try {
    const src = path.join(dir, path.basename(fileKey));
    await storage.download(fileKey, src);
    // -protocol_whitelist file: an uploaded file may only ever read itself — never URLs or other files
    // (defence in depth against playlist/reference tricks that make ffmpeg fetch internal addresses).
    const SAFE = ["-nostdin", "-protocol_whitelist", "file"];
    const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-protocol_whitelist", "file", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", src]));
    const duration = Number(probe?.format?.duration) || null;
    const frame = path.join(dir, "frame.jpg");
    const at = duration && duration > 3 ? "1" : "0";
    await run("ffmpeg", ["-v", "error", ...SAFE, "-ss", at, "-i", src, "-frames:v", "1", "-q:v", "2", "-y", frame]);
    const img = await processImage(await readFile(frame));
    const posters: Variants = {};
    for (const v of img.variants) posters[`${v.width}`] = await storage.put(`${asset.storageKey}/poster-${v.width}.webp`, v.buffer, "image/webp", IMMUTABLE);
    await prisma.mediaAsset.update({
      where: { id: assetId },
      data: {
        status: "READY", variants: posters as Prisma.InputJsonObject, posterUrl: posters[`${img.variants[img.variants.length - 1]!.width}`],
        width: probe?.streams?.[0]?.width ?? img.width, height: probe?.streams?.[0]?.height ?? img.height, durationSec: duration,
      },
    });
    await prisma.propertyMedia.updateMany({ where: { assetId }, data: { url: asset.url } });
    await invalidatePublic("video poster ready"); // listings using this video now have a poster
  } catch (err) {
    // Marked FAILED now; a successful retry sets it back to READY. The video itself still plays without a poster.
    await prisma.mediaAsset.update({ where: { id: assetId }, data: { status: "FAILED" } }).catch(() => undefined);
    logger.warn("video_thumbnail_failed", { assetId, message: (err as Error).message });
    throw err; // lets the queue retry
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Nightly: apply the media expiration strategy (see packages/domain/src/media.ts). */
export async function cleanupMedia(now = new Date()) {
  const candidates = await prisma.mediaAsset.findMany({
    where: { OR: [{ deletedAt: { not: null } }, { usages: { none: {} } }] },
    select: { id: true, storageKey: true, deletedAt: true, createdAt: true, _count: { select: { usages: true } } },
    take: 500,
  });
  let softDeleted = 0, purged = 0;
  for (const a of candidates) {
    const action = mediaLifecycle({ deletedAt: a.deletedAt, createdAt: a.createdAt, usageCount: a._count.usages }, now);
    if (action === "soft_delete") {
      await prisma.mediaAsset.update({ where: { id: a.id }, data: { deletedAt: now } });
      softDeleted++;
    } else if (action === "purge") {
      await storage.removePrefix(a.storageKey);
      await prisma.mediaAsset.delete({ where: { id: a.id } });
      purged++;
    }
  }
  logger.info("media_cleanup", { softDeleted, purged });
  return { softDeleted, purged };
}

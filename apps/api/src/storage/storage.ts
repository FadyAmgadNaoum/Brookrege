import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env";

/** Keys are unique per upload and never overwritten, so media can be cached forever by browsers and the CDN. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

export interface StorageDriver {
  readonly name: "local" | "r2";
  /** Stores an object and returns its public URL. */
  put(key: string, body: Buffer | Readable, contentType: string, cacheControl?: string): Promise<string>;
  /** Copies an object to a local file (video processing). */
  download(key: string, destPath: string): Promise<void>;
  /** Deletes every object under a prefix (an asset's folder). */
  removePrefix(prefix: string): Promise<void>;
  urlFor(key: string): string;
}

const safeKey = (key: string) => {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error(`Unsafe storage key: ${key}`);
  return key;
};

/** Development and single-server fallback: a folder served by Nginx (or Express in dev). */
class LocalDiskDriver implements StorageDriver {
  readonly name = "local" as const;
  constructor(private readonly root: string, private readonly base: string) {}
  urlFor(key: string) { return `${this.base}/${safeKey(key)}`; }
  async put(key: string, body: Buffer | Readable, _type: string) {
    const full = path.join(this.root, safeKey(key));
    await mkdir(path.dirname(full), { recursive: true });
    if (Buffer.isBuffer(body)) await writeFile(full, body);
    else await pipeline(body, createWriteStream(full));
    return this.urlFor(key);
  }
  async download(key: string, destPath: string) {
    await pipeline(createReadStream(path.join(this.root, safeKey(key))), createWriteStream(destPath));
  }
  async removePrefix(prefix: string) {
    const full = path.resolve(this.root, safeKey(prefix));
    if (!full.startsWith(path.resolve(this.root) + path.sep)) return; // traversal guard
    await rm(full, { recursive: true, force: true });
  }
}

/** Cloudflare R2 (S3-compatible). Public reads go through the bucket's custom domain on Cloudflare's CDN. */
class R2Driver implements StorageDriver {
  readonly name = "r2" as const;
  private readonly s3: S3Client;
  constructor(private readonly bucket: string, private readonly base: string, accountId: string, accessKeyId: string, secretAccessKey: string) {
    this.s3 = new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
  }
  urlFor(key: string) { return `${this.base}/${safeKey(key)}`; }
  async put(key: string, body: Buffer | Readable, contentType: string, cacheControl = IMMUTABLE) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: safeKey(key), Body: body, ContentType: contentType, CacheControl: cacheControl }));
    return this.urlFor(key);
  }
  async download(key: string, destPath: string) {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    await pipeline(res.Body as Readable, createWriteStream(destPath));
  }
  async removePrefix(prefix: string) {
    let token: string | undefined;
    do {
      const list = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: safeKey(prefix), ContinuationToken: token }));
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
}

export const storage: StorageDriver =
  env.STORAGE_DRIVER === "r2"
    ? new R2Driver(env.R2_BUCKET!, env.PUBLIC_MEDIA_BASE_URL!.replace(/\/$/, ""), env.R2_ACCOUNT_ID!, env.R2_ACCESS_KEY_ID!, env.R2_SECRET_ACCESS_KEY!)
    : new LocalDiskDriver(path.resolve(env.UPLOAD_DIR), (env.PUBLIC_MEDIA_BASE_URL ?? `${env.PUBLIC_API_URL}/uploads`).replace(/\/$/, ""));

/** Legacy (Phase 1) local URLs → key, used only when deleting old files. */
export function keyFromUrl(url: string): string | null {
  const i = url.indexOf("/uploads/");
  return i === -1 ? null : url.slice(i + "/uploads/".length);
}

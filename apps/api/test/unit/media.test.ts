import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { processImage } from "../../src/modules/media/imagePipeline";
import { sniff } from "../../src/modules/media/sniff";

const photo = (w: number, h: number, withExif = false) => {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 65, g: 89, b: 79 } } }).jpeg();
  if (withExif) img = img.withMetadata({ orientation: 6, exif: { IFD0: { Make: "PhoneCo" }, IFD3: { GPSLatitudeRef: "N" } } });
  return img.toBuffer();
};

test("large photo → 480/960/1600 WebP, never larger than the original", async () => {
  const r = await processImage(await photo(4000, 3000));
  assert.deepEqual(r.variants.map((v) => v.width), [480, 960, 1600]);
  for (const v of r.variants) {
    const m = await sharp(v.buffer).metadata();
    assert.equal(m.format, "webp");
    assert.equal(m.width, v.width);
  }
  assert.equal(r.width, 4000);
});

test("small photo is not upscaled", async () => {
  const r = await processImage(await photo(700, 500));
  assert.deepEqual(r.variants.map((v) => v.width), [480]);
  const tiny = await processImage(await photo(300, 200));
  assert.equal((await sharp(tiny.variants[0]!.buffer).metadata()).width, 300, "withoutEnlargement keeps 300px");
});

test("phone orientation applied and EXIF/GPS stripped (privacy)", async () => {
  const r = await processImage(await photo(1200, 800, true)); // orientation 6 = rotate 90°
  assert.equal(r.width, 800, "portrait after rotation");
  assert.equal(r.height, 1200);
  const m = await sharp(r.variants[0]!.buffer).metadata();
  assert.equal(m.exif, undefined, "no EXIF (no GPS) in published images");
  assert.ok(m.height! > m.width!, "pixels actually rotated");
});

test("compression: WebP variants much smaller than a 4000px JPEG", async () => {
  const src = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#ccc" } }).composite([{ input: Buffer.from(`<svg width="4000" height="3000"><text x="100" y="1500" font-size="400">شقة للبيع</text></svg>`) }]).jpeg({ quality: 92 }).toBuffer();
  const r = await processImage(src);
  const card = r.variants.find((v) => v.width === 480)!.buffer.length;
  assert.ok(card < src.length / 10, `card image ${card} B vs original ${src.length} B`);
});

test("corrupt image is rejected", async () => {
  await assert.rejects(processImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 7)])));
});

test("sniff: formats by magic bytes, HEIC gets a helpful message", async () => {
  assert.equal(sniff(await photo(10, 10)).kind, "IMAGE");
  assert.deepEqual(sniff(await sharp({ create: { width: 5, height: 5, channels: 3, background: "#000" } }).png().toBuffer()), { kind: "IMAGE", ext: "png", mime: "image/png" });
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(20)]);
  assert.deepEqual(sniff(mp4), { kind: "VIDEO", ext: "mp4", mime: "video/mp4" });
  const mov = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.alloc(20)]);
  assert.equal((sniff(mov) as { ext: string }).ext, "mov");
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(20)]);
  const h = sniff(heic);
  assert.equal(h.kind, "UNSUPPORTED");
  assert.match((h as { reason: string }).reason, /HEIC/);
  assert.equal(sniff(Buffer.from("%PDF-1.7 fake pdf file contents")).kind, "UNSUPPORTED");
  assert.equal(sniff(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])).kind, "VIDEO");
});

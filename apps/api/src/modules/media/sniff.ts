/** File type detection from magic bytes — never trust the browser's MIME type or the file name. */
export type Sniffed =
  | { kind: "IMAGE"; ext: "jpg" | "png" | "webp"; mime: string }
  | { kind: "VIDEO"; ext: "mp4" | "mov" | "webm"; mime: string }
  | { kind: "UNSUPPORTED"; reason: string };

export function sniff(head: Buffer): Sniffed {
  if (head.length < 12) return { kind: "UNSUPPORTED", reason: "The file is empty or damaged." };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: "IMAGE", ext: "jpg", mime: "image/jpeg" };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "IMAGE", ext: "png", mime: "image/png" };
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return { kind: "IMAGE", ext: "webp", mime: "image/webp" };
  if (head.readUInt32BE(0) === 0x1a45dfa3) return { kind: "VIDEO", ext: "webm", mime: "video/webm" };
  if (head.toString("ascii", 4, 8) === "ftyp") {
    const brand = head.toString("ascii", 8, 12);
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return { kind: "UNSUPPORTED", reason: "iPhone HEIC photos aren't supported. Export as JPG (Settings › Camera › Formats › Most Compatible)." };
    if (brand === "qt  ") return { kind: "VIDEO", ext: "mov", mime: "video/quicktime" };
    return { kind: "VIDEO", ext: "mp4", mime: "video/mp4" };
  }
  return { kind: "UNSUPPORTED", reason: "Only JPG, PNG, WebP images and MP4, MOV, WebM videos are supported." };
}

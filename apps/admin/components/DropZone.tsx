"use client";

import { useRef, useState, type DragEvent } from "react";
import { MAX_FILES_PER_UPLOAD } from "@brookrege/domain";
import { errorText, uploadFiles } from "@/lib/api";

export interface UploadResponse<T = unknown> { data: T[]; errors: { file: string; message: string }[] }

/** Drag-and-drop (or click) bulk uploader with a progress bar and per-file error list. */
export function DropZone<T>({ path, onDone, compact = false }: { path: string; onDone: (r: UploadResponse<T>) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [problems, setProblems] = useState<{ file: string; message: string }[]>([]);

  async function send(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    setProblems([]);
    if (files.length > MAX_FILES_PER_UPLOAD) {
      setProblems([{ file: `${files.length} files`, message: `Upload up to ${MAX_FILES_PER_UPLOAD} files at a time.` }]);
      return;
    }
    setProgress(0);
    try {
      const r = await uploadFiles<UploadResponse<T>>(path, files, setProgress);
      setProblems(r.errors ?? []);
      onDone(r);
    } catch (e) {
      setProblems([{ file: "Upload", message: errorText(e) }]);
    } finally {
      setProgress(null);
    }
  }

  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (progress === null) void send(e.dataTransfer.files); };

  return (
    <div>
      <div
        role="button" tabIndex={0}
        onClick={() => progress === null && input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-tile border-2 border-dashed text-center transition-colors ${compact ? "p-5" : "p-10"} ${over ? "border-palm bg-palm-tint" : "border-reed bg-white hover:border-palm"}`}
      >
        {progress === null ? (
          <>
            <p className="font-medium">Drop photos or a video here, or click to choose</p>
            <p className="mt-1 text-xs text-silt-soft">JPG, PNG, WebP up to 15 MB · MP4, MOV, WebM up to 95 MB · up to {MAX_FILES_PER_UPLOAD} files</p>
          </>
        ) : (
          <div className="w-full max-w-sm" role="status" aria-live="polite">
            <p className="mb-2 font-medium">{progress < 100 ? `Uploading… ${progress}%` : "Processing images…"}</p>
            <div className="h-2 overflow-hidden rounded-full bg-reed"><div className="h-full bg-palm transition-[width]" style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" className="sr-only" onChange={(e) => { void send(e.target.files ?? []); e.target.value = ""; }} />
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {problems.map((p, i) => <li key={i}><span className="font-medium">{p.file}:</span> {p.message}</li>)}
        </ul>
      )}
    </div>
  );
}

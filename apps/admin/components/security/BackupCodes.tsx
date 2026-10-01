"use client";

import { useState } from "react";

/** Shown once after enabling 2FA or regenerating codes. The person must confirm they saved them. */
export function BackupCodes({ codes, onDone, intro }: { codes: string[]; onDone: () => void; intro: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `Brookrege admin — backup codes\nEach code works once.\n\n${codes.join("\n")}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "brookrege-backup-codes.txt" });
    a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="max-w-lg space-y-4">
      <p>{intro}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border border-reed bg-limestone p-4 font-medium tracking-wider" dir="ltr">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-quiet" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy"}</button>
        <button type="button" className="btn-quiet" onClick={download}>Download</button>
        <button type="button" className="btn-quiet" onClick={() => window.print()}>Print</button>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved these codes somewhere safe (not only on my phone)</label>
      <button className="btn-primary" disabled={!saved} onClick={onDone}>Continue</button>
    </div>
  );
}

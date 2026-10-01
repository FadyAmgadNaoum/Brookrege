"use client";

import type { ReactNode } from "react";

export function PageHeader({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[1.75rem] leading-tight">{title}</h1>
        {children && <p className="mt-1 text-silt-soft">{children}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800">{message}</p> : null;
}

export function Loading() {
  return <p className="py-10 text-center text-silt-soft" role="status">Loading…</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="panel p-8 text-center text-silt-soft">{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-reed">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={`-mb-px border-b-2 px-3 py-2 ${value === i.value ? "border-gold font-medium text-silt" : "border-transparent text-silt-soft hover:text-silt"}`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-3">
      <button className="btn-quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="text-silt-soft">Page {page} of {pageCount}</span>
      <button className="btn-quiet" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

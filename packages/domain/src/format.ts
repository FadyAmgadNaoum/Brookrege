const egp = new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 });

/** 2500000 => "2,500,000 EGP" */
export function formatEGP(amount: number): string {
  return `${egp.format(Math.round(amount))} EGP`;
}

/** 2500000 => "2.5M EGP", 850000 => "850K EGP" — for compact cards and map pins. */
export function formatEGPCompact(amount: number): string {
  if (amount >= 1_000_000) {
    const m = amount / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(m >= 10 ? 1 : 2).replace(/0$/, "")}M EGP`;
  }
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}K EGP`;
  return `${Math.round(amount)} EGP`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

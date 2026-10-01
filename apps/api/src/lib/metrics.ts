/**
 * Minimal Prometheus metrics registry (text exposition format 0.0.4). No dependencies, so it is fully
 * unit-tested and adds nothing to the attack surface. Supports counters, gauges (optionally computed at
 * scrape time) and histograms, with labels.
 *
 * Keep label values low-cardinality: route patterns ("/api/properties/:id"), never raw URLs or IDs.
 */

export type Labels = Record<string, string | number>;
type Collect = () => void | Promise<void>;

const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function escapeLabel(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}
function escapeHelp(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}
function fmt(n: number) {
  if (Number.isNaN(n)) return "NaN";
  if (n === Infinity) return "+Inf";
  if (n === -Infinity) return "-Inf";
  return String(n);
}
function labelKey(names: readonly string[], labels: Labels = {}) {
  for (const k of Object.keys(labels)) if (!names.includes(k)) throw new Error(`Unknown label "${k}"`);
  return names.map((n) => String(labels[n] ?? "")).join("\u0000");
}
function renderLabels(names: readonly string[], key: string, extra?: [string, string]) {
  const values = key === "" && names.length === 0 ? [] : key.split("\u0000");
  const parts = names.map((n, i) => `${n}="${escapeLabel(values[i] ?? "")}"`);
  if (extra) parts.push(`${extra[0]}="${escapeLabel(extra[1])}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

abstract class Metric {
  collect?: Collect;
  constructor(readonly name: string, readonly help: string, readonly labelNames: readonly string[]) {
    if (!NAME_RE.test(name)) throw new Error(`Invalid metric name "${name}"`);
    for (const l of labelNames) if (!LABEL_RE.test(l) || l === "le") throw new Error(`Invalid label name "${l}"`);
  }
  abstract readonly type: "counter" | "gauge" | "histogram";
  abstract lines(): string[];
  render() {
    return [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} ${this.type}`, ...this.lines()].join("\n");
  }
}

export class Counter extends Metric {
  readonly type = "counter" as const;
  private values = new Map<string, number>();
  inc(labels?: Labels, by = 1) {
    if (by < 0) throw new Error("Counters only go up");
    const k = labelKey(this.labelNames, labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  get(labels?: Labels) {
    return this.values.get(labelKey(this.labelNames, labels)) ?? 0;
  }
  /** For totals kept elsewhere (e.g. process CPU time): sets the value, never lowering it. */
  setTotal(labels: Labels | undefined, value: number) {
    const k = labelKey(this.labelNames, labels);
    this.values.set(k, Math.max(this.values.get(k) ?? 0, value));
  }
  lines() {
    if (this.values.size === 0 && this.labelNames.length === 0) return [`${this.name} 0`];
    return [...this.values].map(([k, v]) => `${this.name}${renderLabels(this.labelNames, k)} ${fmt(v)}`);
  }
}

export class Gauge extends Metric {
  readonly type = "gauge" as const;
  private values = new Map<string, number>();
  set(labels: Labels | undefined, value: number) {
    this.values.set(labelKey(this.labelNames, labels), value);
  }
  inc(labels?: Labels, by = 1) {
    const k = labelKey(this.labelNames, labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  dec(labels?: Labels, by = 1) {
    this.inc(labels, -by);
  }
  get(labels?: Labels) {
    return this.values.get(labelKey(this.labelNames, labels));
  }
  /** Drop all series (for gauges recomputed from scratch at each scrape). */
  reset() {
    this.values.clear();
  }
  lines() {
    return [...this.values].map(([k, v]) => `${this.name}${renderLabels(this.labelNames, k)} ${fmt(v)}`);
  }
}

export class Histogram extends Metric {
  readonly type = "histogram" as const;
  private series = new Map<string, { counts: number[]; sum: number; count: number }>();
  readonly buckets: number[];
  constructor(name: string, help: string, labelNames: readonly string[], buckets: number[]) {
    super(name, help, labelNames);
    this.buckets = [...buckets].sort((a, b) => a - b);
  }
  observe(labels: Labels | undefined, value: number) {
    const k = labelKey(this.labelNames, labels);
    let s = this.series.get(k);
    if (!s) this.series.set(k, (s = { counts: this.buckets.map(() => 0), sum: 0, count: 0 }));
    // Each bucket counts observations <= its bound; rendering makes them cumulative.
    const i = this.buckets.findIndex((b) => value <= b);
    if (i >= 0) s.counts[i]! += 1;
    s.sum += value;
    s.count += 1;
  }
  /** Starts a timer; call the returned function to record the elapsed seconds. */
  startTimer(labels?: Labels) {
    const start = process.hrtime.bigint();
    return (more?: Labels) => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.observe({ ...labels, ...more }, seconds);
      return seconds;
    };
  }
  lines() {
    const out: string[] = [];
    for (const [k, s] of this.series) {
      let cumulative = 0;
      this.buckets.forEach((b, i) => {
        cumulative += s.counts[i]!;
        out.push(`${this.name}_bucket${renderLabels(this.labelNames, k, ["le", fmt(b)])} ${cumulative}`);
      });
      out.push(`${this.name}_bucket${renderLabels(this.labelNames, k, ["le", "+Inf"])} ${s.count}`);
      out.push(`${this.name}_sum${renderLabels(this.labelNames, k)} ${fmt(s.sum)}`);
      out.push(`${this.name}_count${renderLabels(this.labelNames, k)} ${s.count}`);
    }
    return out;
  }
}

export class Registry {
  private metrics = new Map<string, Metric>();
  private collectors: Collect[] = [];

  private add<M extends Metric>(m: M): M {
    const existing = this.metrics.get(m.name);
    if (existing) {
      if (existing.type !== m.type) throw new Error(`Metric ${m.name} already registered as ${existing.type}`);
      return existing as M;
    }
    this.metrics.set(m.name, m);
    return m;
  }
  counter(name: string, help: string, labelNames: readonly string[] = []) {
    return this.add(new Counter(name, help, labelNames));
  }
  gauge(name: string, help: string, labelNames: readonly string[] = [], collect?: Collect) {
    const g = this.add(new Gauge(name, help, labelNames));
    if (collect) g.collect = collect;
    return g;
  }
  histogram(name: string, help: string, labelNames: readonly string[] = [], buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    return this.add(new Histogram(name, help, labelNames, buckets));
  }
  /** Runs before every scrape (e.g. read process stats). Errors are swallowed so one bad collector can't break /metrics. */
  onCollect(fn: Collect) {
    this.collectors.push(fn);
  }
  async render(): Promise<string> {
    const jobs = [...this.collectors, ...[...this.metrics.values()].flatMap((m) => (m.collect ? [m.collect] : []))];
    await Promise.all(jobs.map(async (fn) => { try { await fn(); } catch { /* keep serving the rest */ } }));
    return [...this.metrics.values()].map((m) => m.render()).join("\n") + "\n";
  }
  get(name: string) {
    return this.metrics.get(name);
  }
}

export const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** Collapses IDs in unmatched paths so a scanner can't create thousands of series. */
export function normalizeRoute(baseUrl: string, routePath: string | undefined): string {
  if (!routePath) return "unmatched";
  const joined = `${baseUrl}${routePath === "/" && baseUrl ? "" : routePath}`;
  return joined || "/";
}

/** Status grouped to keep series small but still separate 4xx kinds that matter for alerts. */
export function statusClass(status: number): string {
  if ([401, 403, 404, 413, 423, 429].includes(status)) return String(status);
  return `${Math.floor(status / 100)}xx`;
}

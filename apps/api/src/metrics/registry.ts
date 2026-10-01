import { monitorEventLoopDelay } from "node:perf_hooks";
import { Registry } from "../lib/metrics";

/**
 * All application metrics in one place (names are the contract with the Grafana dashboards and
 * alert rules in infra/monitoring — change them together). Prefix: brookrege_ for app-specific series.
 */
export const registry = new Registry();

// ── HTTP ──
export const httpRequests = registry.counter("http_requests_total", "HTTP requests handled, by route pattern and status.", ["method", "route", "status"]);
export const httpDuration = registry.histogram(
  "http_request_duration_seconds", "Time to handle an HTTP request, by route pattern.", ["method", "route"],
  [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);
export const httpInFlight = registry.gauge("http_requests_in_flight", "Requests being handled right now.");

// ── Security ──
export const authEvents = registry.counter("brookrege_auth_events_total", "Admin sign-in events.", ["event"]);
export const securityBlocks = registry.counter("brookrege_security_blocks_total", "Admin requests refused by a guard.", ["reason"]);

// ── Jobs & notifications ──
export const jobsProcessed = registry.counter("brookrege_jobs_processed_total", "Background jobs finished, by type and outcome (done, retry, failed).", ["type", "outcome"]);
export const jobDuration = registry.histogram("brookrege_job_duration_seconds", "Background job run time.", ["type"], [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300]);
export const notifications = registry.counter("brookrege_notifications_total", "Emails and text messages, by channel and delivery status.", ["channel", "status"]);

// ── Leads & cache ──
export const leadsCreated = registry.counter("brookrege_leads_created_total", "Inquiries and property requests received.", ["kind"]);
export const cacheRequests = registry.counter("brookrege_cache_requests_total", "Cache lookups, by cache level and result.", ["level", "result"]);

// ── Process (Node.js) ──
const startedAt = Date.now() / 1000;
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
const cpu = registry.counter("process_cpu_seconds_total", "CPU time used by this process.");
const rss = registry.gauge("process_resident_memory_bytes", "Memory held by this process.");
const heap = registry.gauge("nodejs_heap_used_bytes", "JavaScript heap in use.");
const lagP99 = registry.gauge("nodejs_eventloop_lag_p99_seconds", "Event-loop delay (99th percentile since the last scrape). High = the process is overloaded.");
const start = registry.gauge("process_start_time_seconds", "When this process started (Unix time).");
registry.onCollect(() => {
  const u = process.cpuUsage();
  cpu.setTotal(undefined, (u.user + u.system) / 1e6);
  const m = process.memoryUsage();
  rss.set(undefined, m.rss);
  heap.set(undefined, m.heapUsed);
  lagP99.set(undefined, eventLoop.percentile(99) / 1e9);
  eventLoop.reset();
  start.set(undefined, startedAt);
});

export const appInfo = registry.gauge("brookrege_app_info", "Always 1; labels describe this process.", ["role", "instance", "version"]);

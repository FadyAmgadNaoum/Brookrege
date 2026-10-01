/** Background job retry policy: exponential backoff with a cap and small jitter. */
export const JOB_TYPES = ["send_email", "send_sms", "video_thumbnail", "scheduled_report", "media_cleanup", "expiring_digest", "privacy_retention"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export function backoffMs(attempt: number, baseMs = 30_000, capMs = 3_600_000, random = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.9 + random() * 0.2));
}

export const shouldRetry = (attempts: number, maxAttempts: number) => attempts < maxAttempts;

/** When a scheduled report is next due (weekly: Sundays 07:00 Cairo ≈ 05:00 UTC; monthly: 1st). */
export function nextReportRun(frequency: "WEEKLY" | "MONTHLY", after: Date): Date {
  const d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), 5, 0, 0));
  if (frequency === "WEEKLY") {
    while (d.getUTCDay() !== 0 || d <= after) d.setUTCDate(d.getUTCDate() + 1); // next Sunday 05:00 UTC strictly after
    return d;
  }
  const m = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), 1, 5, 0, 0));
  if (m <= after) m.setUTCMonth(m.getUTCMonth() + 1);
  return m;
}

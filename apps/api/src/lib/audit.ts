import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "./prisma";
import { logger } from "./logger";
import { authEvents } from "../metrics/registry";

interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

const json = (v: unknown) =>
  v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Records who changed what. When `tx` is passed the entry is written inside the
 * same transaction as the change (all-or-nothing). Without `tx`, a failure is
 * logged loudly but never undoes a change that already succeeded.
 */
export async function audit(req: Request | null, entry: AuditEntry, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  // Sign-in and account events also feed the security dashboard (bounded set of names, no user data).
  if (entry.action.startsWith("auth.")) authEvents.inc({ event: entry.action.slice(5) });
  try {
    await client.auditLog.create({
      data: {
        actorId: req?.user?.id ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: json(entry.before),
        after: json(entry.after),
        ip: req?.ip ?? null,
        userAgent: req?.get("user-agent")?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    if (tx) throw err;
    logger.error("audit_write_failed", { err, entry });
  }
}

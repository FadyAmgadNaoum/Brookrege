import type { Restriction, Role } from "@brookrege/domain";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role; email: string };
      /** Set by `authenticate`: the server-side session behind this request. */
      auth?: { sessionId: string; restriction: Restriction };
    }
  }
}
export {};

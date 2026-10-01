export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found.`);
export const unauthorized = (msg = "Sign in to continue.") => new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You don't have permission to do this.") => new AppError(403, "FORBIDDEN", msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);

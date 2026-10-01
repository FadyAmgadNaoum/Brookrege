/**
 * Where to go after sign-in. Only same-site paths are accepted: rejects "//evil.com",
 * "/\evil.com" (browsers treat "\" like "/"), absolute URLs and control characters.
 */
export function safeNext(next: string | null): string {
  if (!next || !/^\/(?![/\\])[^\s\x00-\x1f\\]*$/.test(next)) return "/";
  return next;
}

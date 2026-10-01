/** Notification templates: {{variable}} placeholders, HTML-escaped for email bodies. */
const VAR = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VAR)].map((m) => m[1]!))];
}

export interface RenderResult { text: string; missing: string[] }

/** Unknown variables render as empty and are reported in `missing` (logged, never crash a send). */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>, opts: { html?: boolean } = {}): RenderResult {
  const missing: string[] = [];
  const text = template.replace(VAR, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null) {
      missing.push(name);
      return "";
    }
    return opts.html ? escapeHtml(String(v)) : String(v);
  });
  return { text, missing: [...new Set(missing)] };
}

/** SMS length: GSM-7 = 160 chars/segment, Unicode (Arabic) = 70; multipart 153 / 67. */
export function smsSegments(text: string): { encoding: "GSM-7" | "UCS-2"; segments: number } {
  const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(text);
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  const segments = text.length <= single ? 1 : Math.ceil(text.length / multi);
  return { encoding: gsm ? "GSM-7" : "UCS-2", segments };
}

/** Egyptian mobile → E.164 (+20…), required by SMS providers. Returns null if not a valid Egyptian mobile. */
export function toE164Egypt(phone: string): string | null {
  const d = phone.replace(/[^\d+]/g, "");
  if (/^\+201[0125]\d{8}$/.test(d)) return d;
  if (/^00201[0125]\d{8}$/.test(d)) return `+${d.slice(2)}`;
  if (/^201[0125]\d{8}$/.test(d)) return `+${d}`;
  if (/^01[0125]\d{8}$/.test(d)) return `+20${d.slice(1)}`;
  return null;
}

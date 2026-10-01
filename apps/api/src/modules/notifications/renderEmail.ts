import { escapeHtml, renderTemplate } from "@brookrege/domain";

type Vars = Record<string, string | number | null | undefined>;

/**
 * Builds the HTML and plain-text versions of an email. Both the template text (editable by staff)
 * and the values (typed by website visitors) are HTML-escaped, so neither can inject markup,
 * links or tracking pixels into the email. Line breaks become <br>.
 */
export function renderEmail(t: { subject: string | null; body: string; locale: string }, vars: Vars) {
  const subject = renderTemplate(t.subject ?? "", vars).text.replace(/[\r\n]+/g, " ").slice(0, 200);
  const text = renderTemplate(t.body, vars).text;
  const bodyHtml = renderTemplate(escapeHtml(t.body), vars, { html: true }).text.replace(/\n/g, "<br>");
  return { subject, text, html: layout(bodyHtml, t.locale === "ar" ? "ar" : "en") };
}

const layout = (html: string, locale: "ar" | "en") => `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><body style="margin:0;background:#F2F3EF;font-family:Tahoma,Arial,sans-serif;color:#22302C">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;padding:28px;line-height:1.7;font-size:15px">
<div style="font-weight:600;font-size:18px;margin-bottom:16px;color:#41594F">Brookrege</div>${html}</div></body></html>`;

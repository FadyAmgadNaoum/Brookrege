export interface EmailMessage { to: string[]; subject: string; html: string; text: string; attachments?: { filename: string; contentBase64: string; type: string }[] }
export interface SendResult { provider: string; messageId: string | null }

/** Thrown for errors that retrying won't fix (bad key, invalid recipient) — the job fails immediately. */
export class PermanentSendError extends Error {}

const failFor = async (res: Response, provider: string) => {
  const body = (await res.text()).slice(0, 500);
  const msg = `${provider} ${res.status}: ${body}`;
  // 4xx (except 429 rate limit) will fail again on retry.
  if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentSendError(msg);
  throw new Error(msg);
};

/** SendGrid v3 Mail Send (plain HTTPS — no SDK needed). */
export async function sendgridSend(apiKey: string, from: { email: string; name: string }, m: EmailMessage): Promise<SendResult> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: m.to.map((email) => ({ email })) }],
      from,
      subject: m.subject,
      content: [{ type: "text/plain", value: m.text }, { type: "text/html", value: m.html }],
      attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.contentBase64, type: a.type, disposition: "attachment" })),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status !== 202) await failFor(res, "SendGrid");
  return { provider: "sendgrid", messageId: res.headers.get("x-message-id") };
}

/** Twilio Programmable Messaging (form-encoded REST). */
export async function twilioSend(cfg: { accountSid: string; authToken: string; from?: string; messagingServiceSid?: string }, to: string, body: string): Promise<SendResult> {
  const form = new URLSearchParams({ To: to, Body: body });
  if (cfg.messagingServiceSid) form.set("MessagingServiceSid", cfg.messagingServiceSid);
  else if (cfg.from) form.set("From", cfg.from);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status !== 201) await failFor(res, "Twilio");
  const json = (await res.json()) as { sid?: string };
  return { provider: "twilio", messageId: json.sid ?? null };
}

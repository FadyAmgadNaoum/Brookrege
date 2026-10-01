import { test } from "node:test";
import assert from "node:assert/strict";
import { PermanentSendError, sendgridSend, twilioSend } from "../../src/modules/notifications/providers";

type Call = { url: string; init: RequestInit };
function mockFetch(status: number, body: string, headers: Record<string, string> = {}) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : body, { status, headers });
  }) as typeof fetch;
  return calls;
}

test("SendGrid: request shape, attachment, message id", async () => {
  const calls = mockFetch(202, "", { "x-message-id": "abc123" });
  const r = await sendgridSend("SG.key", { email: "no-reply@b.com", name: "Brookrege" },
    { to: ["a@b.com"], subject: "استفسار", html: "<p>x</p>", text: "x", attachments: [{ filename: "r.csv", contentBase64: "YQ==", type: "text/csv" }] });
  assert.equal(r.messageId, "abc123");
  assert.equal(calls[0]!.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer SG.key");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.equal(body.personalizations[0].to[0].email, "a@b.com");
  assert.equal(body.subject, "استفسار");
  assert.equal(body.attachments[0].disposition, "attachment");
});

test("SendGrid: 401 is permanent (no retry), 500 and 429 are temporary", async () => {
  mockFetch(401, "bad key");
  await assert.rejects(sendgridSend("k", { email: "a@b.com", name: "B" }, { to: ["x@y.com"], subject: "s", html: "", text: "" }), PermanentSendError);
  mockFetch(500, "oops");
  await assert.rejects(sendgridSend("k", { email: "a@b.com", name: "B" }, { to: ["x@y.com"], subject: "s", html: "", text: "" }), (e: Error) => !(e instanceof PermanentSendError));
  mockFetch(429, "slow down");
  await assert.rejects(sendgridSend("k", { email: "a@b.com", name: "B" }, { to: ["x@y.com"], subject: "s", html: "", text: "" }), (e: Error) => !(e instanceof PermanentSendError));
});

test("Twilio: form body, basic auth, messaging service preferred", async () => {
  const calls = mockFetch(201, JSON.stringify({ sid: "SM1" }));
  const r = await twilioSend({ accountSid: "AC" + "0".repeat(32), authToken: "tok", from: "+15550001111", messagingServiceSid: "MG" + "1".repeat(32) }, "+201012345678", "شكرًا");
  assert.equal(r.messageId, "SM1");
  assert.match(calls[0]!.url, /Accounts\/AC0+\/Messages\.json$/);
  const form = new URLSearchParams(calls[0]!.init.body as string);
  assert.equal(form.get("To"), "+201012345678");
  assert.equal(form.get("Body"), "شكرًا");
  assert.equal(form.get("MessagingServiceSid"), "MG" + "1".repeat(32));
  assert.equal(form.get("From"), null);
  const auth = (calls[0]!.init.headers as Record<string, string>).Authorization!;
  assert.equal(Buffer.from(auth.split(" ")[1]!, "base64").toString(), `AC${"0".repeat(32)}:tok`);
});

test("Twilio: invalid number (400) is permanent", async () => {
  mockFetch(400, JSON.stringify({ code: 21211 }));
  await assert.rejects(twilioSend({ accountSid: "AC", authToken: "t", from: "+1" }, "+20", "x"), PermanentSendError);
});

"use client";

import { useI18n } from "@/lib/i18n/client";
import { LeadForm } from "./LeadForm";

export function InquiryForm({ propertyId }: { propertyId: string }) {
  const { t } = useI18n();
  const f = t.forms;
  return (
    <LeadForm endpoint="/inquiries" extra={{ propertyId }} submitLabel={f.requestCall} successTitle={f.sentTitle} successBody={f.sentBody}>
      {(err) => (
        <>
          <div>
            <label htmlFor="i-name" className="label">{f.name}</label>
            <input id="i-name" name="name" required autoComplete="name" className="field" />
            {err("name")}
          </div>
          <div>
            <label htmlFor="i-phone" className="label">{f.phone}</label>
            <input id="i-phone" name="phone" required type="tel" dir="ltr" autoComplete="tel" placeholder={f.phonePh} className="field text-start" />
            {err("phone")}
          </div>
          <div>
            <label htmlFor="i-msg" className="label">{f.message}</label>
            <textarea id="i-msg" name="message" rows={3} className="field h-auto py-2" placeholder={f.messagePh} />
            {err("message")}
          </div>
        </>
      )}
    </LeadForm>
  );
}

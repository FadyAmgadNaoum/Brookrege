"use client";

import { PROPERTY_TYPES } from "@brookrege/domain";
import { LeadForm } from "@/components/LeadForm";
import { useI18n } from "@/lib/i18n/client";

export function SubmissionForm() {
  const { t } = useI18n();
  const a = t.add;
  return (
    <LeadForm endpoint="/submissions" submitLabel={a.submit} successTitle={a.sentTitle} successBody={a.sentBody}>
      {(err) => (
        <>
          <div>
            <label htmlFor="s-name" className="label">{a.ownerName}</label>
            <input id="s-name" name="ownerName" required autoComplete="name" className="field" />
            {err("ownerName")}
          </div>
          <div>
            <label htmlFor="s-phone" className="label">{t.forms.phone}</label>
            <input id="s-phone" name="phone" required type="tel" autoComplete="tel" dir="ltr" placeholder={t.forms.phonePh} className="field text-start" />
            {err("phone")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="s-tx" className="label">{a.want}</label>
              <select id="s-tx" name="transaction" className="field" defaultValue="">
                <option value="">{a.choose}</option>
                <option value="SALE">{a.sell}</option>
                <option value="RENT">{a.rentOut}</option>
              </select>
            </div>
            <div>
              <label htmlFor="s-type" className="label">{a.type}</label>
              <select id="s-type" name="propertyType" className="field" defaultValue="">
                <option value="">{a.choose}</option>
                {PROPERTY_TYPES.map((x) => <option key={x} value={x}>{t.types[x]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="s-loc" className="label">{a.location}</label>
            <input id="s-loc" name="location" className="field" placeholder={a.locationPh} />
          </div>
          <div>
            <label htmlFor="s-det" className="label">{a.details}</label>
            <textarea id="s-det" name="details" rows={4} className="field h-auto py-2" placeholder={a.detailsPh} />
            {err("details")}
          </div>
        </>
      )}
    </LeadForm>
  );
}

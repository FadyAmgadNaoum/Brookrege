import type { NotificationChannel } from "@prisma/client";
import { prisma } from "../../lib/prisma";

/** Seeded once; staff can edit them in Admin › Notifications. Existing edits are never overwritten. */
const T: { key: string; channel: NotificationChannel; locale: string; subject?: string; body: string }[] = [
  { key: "inquiry_staff", channel: "EMAIL", locale: "ar", subject: "استفسار جديد: {{propertyTitle}}",
    body: "وصل استفسار جديد.\n\nالاسم: {{name}}\nالموبايل: {{phone}}\nالعقار: {{propertyTitle}}\nالرسالة: {{message}}\n\nافتح لوحة التحكم: {{adminUrl}}" },
  { key: "inquiry_staff", channel: "EMAIL", locale: "en", subject: "New inquiry: {{propertyTitle}}",
    body: "A new inquiry arrived.\n\nName: {{name}}\nMobile: {{phone}}\nProperty: {{propertyTitle}}\nMessage: {{message}}\n\nOpen the admin: {{adminUrl}}" },
  { key: "inquiry_customer_ack", channel: "SMS", locale: "ar", body: "شكرًا {{name}}، وصلنا طلبك بخصوص {{propertyTitle}}. سيتصل بك فريق Brookrege قريبًا." },
  { key: "inquiry_customer_ack", channel: "SMS", locale: "en", body: "Thanks {{name}}, we got your request about {{propertyTitle}}. The Brookrege team will call you soon." },
  { key: "submission_staff", channel: "EMAIL", locale: "ar", subject: "طلب إضافة عقار من {{ownerName}}",
    body: "مالك يريد عرض عقاره.\n\nالاسم: {{ownerName}}\nالموبايل: {{phone}}\nالنوع: {{propertyType}}\nالغرض: {{transaction}}\nالموقع: {{location}}\nالتفاصيل: {{details}}\n\n{{adminUrl}}" },
  { key: "submission_staff", channel: "EMAIL", locale: "en", subject: "Property submission from {{ownerName}}",
    body: "An owner wants to list a property.\n\nName: {{ownerName}}\nMobile: {{phone}}\nType: {{propertyType}}\nFor: {{transaction}}\nLocation: {{location}}\nDetails: {{details}}\n\n{{adminUrl}}" },
  { key: "submission_owner_ack", channel: "SMS", locale: "ar", body: "شكرًا {{ownerName}}، وصلتنا بيانات عقارك. سيتصل بك فريق Brookrege لترتيب التصوير والنشر." },
  { key: "submission_owner_ack", channel: "SMS", locale: "en", body: "Thanks {{ownerName}}, we received your property details. Brookrege will call you to arrange photos." },
  { key: "team_welcome", channel: "EMAIL", locale: "en", subject: "Your Brookrege admin account",
    body: "Hello {{name}},\n\nAn account was created for you on the Brookrege admin ({{role}}).\nSign in at {{adminUrl}} with this email address and the password your administrator gives you.\n\nFor security, passwords are never sent by email." },
  { key: "expiring_digest", channel: "EMAIL", locale: "en", subject: "{{count}} listing(s) expire within 14 days",
    body: "These listings go offline soon unless renewed:\n\n{{list}}\n\nRenew them in the admin: {{adminUrl}}" },
  { key: "scheduled_report", channel: "EMAIL", locale: "en", subject: "Brookrege {{reportName}} report: {{period}}",
    body: "Your scheduled {{reportName}} report for {{period}} is attached.\n\n{{summary}}\n\nManage schedules: {{adminUrl}}" },
  { key: "security_alert", channel: "EMAIL", locale: "en", subject: "Security notice for your Brookrege account",
    body: "Hello {{name}},\n\n{{event}}\n\nTime: {{when}}\nNetwork address: {{ip}}\n\nIf this was you, no action is needed. If not, contact a super admin right away and change your password.\n\n{{adminUrl}}" },
  { key: "test", channel: "EMAIL", locale: "en", subject: "Brookrege test email", body: "This is a test email from the Brookrege admin. Email is working." },
  { key: "test", channel: "SMS", locale: "en", body: "Brookrege test message. SMS is working." },
];

export async function ensureDefaultTemplates() {
  await prisma.notificationTemplate.createMany({ data: T.map((t) => ({ ...t, subject: t.subject ?? null })), skipDuplicates: true });
}

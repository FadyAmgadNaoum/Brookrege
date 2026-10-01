# إطلاق الموقع الآن — Launch Brookrege now

الموقع والنظام كاملين وجاهزين. المطلوب منك فقط: سيرفر، ودومين، وأمر واحد. حوالي ٤٥ دقيقة إجمالًا.
The whole system is ready. You need a server, the domain, and one command — about 45 minutes in total.

---

## ١. اشترِ سيرفر (VPS) — Buy a server

- نظام التشغيل: **Ubuntu 24.04** (أو 22.04).
- الحجم: **4 vCPU و 8 GB رام** (الحد الأدنى 2 vCPU و 4 GB). مساحة 80 GB أو أكثر.
- أي شركة مناسبة: Hostinger (KVM 2 أو أعلى)، Contabo، DigitalOcean، Hetzner.
- احتفظ بـ **عنوان الـ IP** وكلمة سر الـ root (أو ضع مفتاح SSH عند الإنشاء — أفضل).

OS Ubuntu 24.04 · 4 vCPU / 8 GB RAM recommended (2 vCPU / 4 GB minimum) · 80 GB disk. Keep the IP address.

## ٢. وجّه الدومين للسيرفر — Point the domain at the server

في لوحة الدومين (أو Cloudflare) أضف ٣ سجلات من نوع **A** كلها بقيمة الـ IP بتاع السيرفر:

| Type | Name | Value |
|---|---|---|
| A | `@` | IP السيرفر |
| A | `www` | IP السيرفر |
| A | `admin` | IP السيرفر |

لو بتستخدم Cloudflare: خلّي السحابة **رمادي (DNS only)** وقت التثبيت، وبعد ما الموقع يشتغل خليها برتقالي (الخطوة ٦).
انتظر ٥–١٥ دقيقة حتى تنتشر السجلات.

With Cloudflare, keep the records **DNS only (grey cloud)** during the install; switch to the orange cloud after (step 6).

## ٣. ارفع المشروع وشغّل المثبّت — Upload and run the installer

من جهازك (Windows: افتح PowerShell؛ Mac: Terminal)، في المجلد اللي فيه `brookrege-website.zip`:

```bash
scp brookrege-website.zip root@SERVER_IP:/opt/
ssh root@SERVER_IP
```

ثم على السيرفر:

```bash
apt-get update && apt-get install -y unzip
cd /opt && unzip -q brookrege-website.zip && cd brookrege
bash scripts/install/install.sh
```

(بديل لـ scp: برنامج **WinSCP** أو مدير الملفات في لوحة الشركة — ارفع الملف إلى `/opt`.)

المثبّت يسألك ٣ أسئلة فقط: **الدومين**، **إيميلك**، **رقم الواتساب** (بكود الدولة، مثال 201001234567).
بعدها يعمل كل شيء بنفسه: Docker، الجدار الناري، كلمات سر عشوائية قوية، شهادة HTTPS وتجديدها التلقائي، النسخ الاحتياطي
المشفر كل ليلة، الموقع ولوحة التحكم وقاعدة البيانات، وحساب المدير الأول. البناء يأخذ ١٠–٢٠ دقيقة أول مرة.

The installer asks three questions (domain, your email, WhatsApp number) and does everything else. First build: 10–20 minutes.

## ٤. احفظ شيئين يظهران مرة واحدة فقط — Save two things (shown once)

في آخر التثبيت ستظهر:
1. **كلمة سر المدير** — للدخول على `https://admin.<الدومين>`. اكتبها عندك.
2. **مفتاح النسخ الاحتياطي** (سطور تبدأ بـ `AGE-SECRET-KEY`) — بدونه لا يمكن استرجاع أي نسخة احتياطية.
   انسخه في مدير كلمات سر **واطبعه** واحفظ الورقة. اكتب `SAVED` فيُحذف من السيرفر.

At the end you'll see the **admin password** and the **backup key**. Store the key in a password manager and on paper; type `SAVED` and it's deleted from the server.

## ٥. أول دخول — First sign-in (10 minutes)

1. افتح `https://admin.<الدومين>` وادخل بإيميلك وكلمة السر.
2. (اختياري) التحقق بخطوتين: مقفول افتراضيًا. تقدر تفعّله لنفسك من My account › Two-step verification، أو تخليه إجباري للكل من Security › Policy.
3. أضف المناطق والكمبوندات (Regions, compounds & projects) ثم العقارات بالصور (Listings › Add listing).
4. أضف فريقك (Team › Add member).
دليل لوحة التحكم الكامل: `docs/training/admin-manual/Brookrege-Admin-Manual.pdf`.

Sign in (2-step verification is optional — My account, or Security › Policy to require it for all), add regions/compounds/listings, add your team. Full guide: the admin manual PDF.

## ٦. بعد الإطلاق (نفس اليوم أو الأسبوع الأول) — After launch

| | الخطوة | الدليل |
|---|---|---|
| ☐ | Cloudflare: السحابة برتقالي للسجلات الثلاثة، SSL/TLS = **Full (strict)** | `docs/security/INFRASTRUCTURE.md` |
| ☐ | إيميل الموقع (SendGrid) و SMS (Twilio) من Admin › Notifications | `docs/operations/SUPPORT-EMAIL.md` |
| ☐ | support@ و privacy@ (Cloudflare Email Routing، مجاني) | `docs/operations/SUPPORT-EMAIL.md` |
| ☐ | Google Search Console: أضف الدومين وقدّم `sitemap.xml` | `docs/launch/LAUNCH-CHECKLIST.md` |
| ☐ | فيديوهات الصفحة الرئيسية: تأكد من حق الاستخدام أو استبدلها بفيديو مشروع حقيقي | `docs/HOME-FILM.md` |
| ☐ | مراجعة محامٍ لسياسة الخصوصية | `docs/security/PRIVACY.md` |
| ☐ | المراقبة والتنبيهات (Grafana) | `docs/operations/MONITORING.md` |

## أوامر مفيدة — Useful commands (on the server, in /opt/brookrege)

```bash
bash scripts/install/install.sh --status     # ما الذي يعمل — what's running
bash scripts/install/install.sh --update     # بعد استبدال الملفات بنسخة أحدث: نسخة احتياطية ثم تحديث
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail 50 api   # السجلات
ls -lh backups/                               # النسخ الاحتياطية المشفرة
```

## لو حصلت مشكلة — If something goes wrong

| الرسالة | السبب والحل |
|---|---|
| `The certificate couldn't be issued` | الدومين لسه مش موجّه للسيرفر، أو سحابة Cloudflare برتقالي. صحّح وانتظر ١٠ دقائق وأعد نفس الأمر. |
| `Only N GB free disk` | السيرفر صغير؛ اختر خطة بمساحة أكبر. |
| `didn't become healthy` | السجلات تظهر تحت الرسالة؛ أعد تشغيل الأمر. لو تكررت: أرسل آخر ٤٠ سطر للدعم الفني. |
| الموقع يفتح لكن الصور/الفيديو لا تظهر | امسح الكاش في Cloudflare (Caching › Purge Everything). |
| نسيت كلمة سر المدير / فقدت الموبايل | على السيرفر: `bash scripts/ops/reset-admin-access.sh إيميلك` — يعطيك كلمة سر مؤقتة جديدة. |

المثبّت آمن لإعادة التشغيل: أي خطوة اكتملت لا تُعاد، والإعدادات وكلمات السر تبقى كما هي.
The installer is safe to run again: finished steps are skipped and your settings are kept.

---

**النمو لاحقًا — Growing later:** عند زيادة الزيارات انتقل لـ ٣ سيرفرات (`docs/PHASE2-WEEK5.md`) ونظام النشر من GitHub بزر واحد
(`docs/operations/DEPLOYMENT-RUNBOOK.md`). Move to three servers and one-click GitHub deploys when traffic grows.

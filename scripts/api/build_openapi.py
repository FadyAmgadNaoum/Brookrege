#!/usr/bin/env python3
"""
Builds the API reference: docs/api/openapi.yaml (OpenAPI 3.0) and docs/api/index.html (Redoc viewer).
    python3 scripts/api/build_openapi.py
The route list is checked against the code by scripts/api/routes.py --check (CI), so a new endpoint
without documentation fails the build.
"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "api"

def ref(name): return {"$ref": f"#/components/schemas/{name}"}
def arr(item): return {"type": "array", "items": item}
def obj(props, required=()):
    o = {"type": "object", "properties": props}
    if required: o["required"] = list(required)
    return o
S = lambda **k: {"type": "string", **k}
I = lambda **k: {"type": "integer", **k}
N = lambda **k: {"type": "number", **k}
B = {"type": "boolean"}
NS = lambda **k: {"type": "string", "nullable": True, **k}
DT = {"type": "string", "format": "date-time"}
data = lambda schema: obj({"data": schema}, ["data"])
paged = lambda item: obj({"data": arr(item), "meta": ref("PageMeta")}, ["data", "meta"])

PROPERTY_TYPES = ["APARTMENT", "VILLA", "TOWNHOUSE", "STUDIO", "SHOP", "ADMINISTRATIVE", "LAND"]
ROLES = ["SUPER_ADMIN", "CONTENT_ADMIN", "MODERATOR"]

schemas = {
    "Error": obj({"error": obj({"code": S(example="BAD_REQUEST"), "message": S(description="Plain-English explanation, safe to show."),
                                "details": {"type": "object", "additionalProperties": arr(S()), "description": "Per-field messages for validation errors."}}, ["code", "message"])}, ["error"]),
    "PageMeta": obj({"total": I(), "page": I(), "pageSize": I(), "pageCount": I()}),
    "Place": obj({"name": S(), "nameAr": NS(), "slug": S()}),
    "Variants": {"type": "object", "additionalProperties": S(format="uri"), "description": "WebP URL per width: 480, 960, 1600.", "example": {"480": "https://media.brookrege.com/a/480.webp"}},
    "Media": obj({"url": S(), "alt": NS(), "asset": {"nullable": True, **obj({"kind": S(enum=["IMAGE", "VIDEO"]), "status": S(enum=["PROCESSING", "READY", "FAILED"]), "variants": {"nullable": True, **ref("Variants")}, "posterUrl": NS()})}}),
    "PropertyCard": obj({"id": S(), "title": S(description="Arabic (primary)"), "titleEn": NS(), "type": S(enum=PROPERTY_TYPES), "transaction": S(enum=["SALE", "RENT"]),
                         "sellerType": NS(enum=["DEVELOPER", "RESALE"]), "price": N(description="EGP (monthly for rent)"), "areaSqm": I(), "bedrooms": I(nullable=True), "bathrooms": I(nullable=True),
                         "isFeatured": B, "listedAt": DT, "region": ref("Place"), "compound": {"nullable": True, **ref("Place")}, "media": arr(ref("Media"))}),
    "PropertyDetail": {"allOf": [ref("PropertyCard"), obj({"description": NS(), "descriptionEn": NS(), "address": NS(), "latitude": N(nullable=True), "longitude": N(nullable=True)})]},
    "MapPoint": obj({"id": S(), "title": S(), "titleEn": NS(), "type": S(), "transaction": S(), "sellerType": NS(), "price": N(), "latitude": N(), "longitude": N()}),
    "TypeSummary": obj({"type": S(enum=PROPERTY_TYPES), "startingFrom": N(nullable=True), "availableUnits": I()}),
    "Region": obj({"id": S(), "name": S(), "nameAr": NS(), "slug": S()}),
    "CompoundSummary": obj({"id": S(), "name": S(), "nameAr": NS(), "slug": S(), "developerName": NS(), "coverImageUrl": NS(), "region": ref("Place"),
                            "availableUnits": I(), "startingFrom": N(nullable=True), "types": arr(ref("TypeSummary"))}),
    "Compound": obj({"id": S(), "name": S(), "nameAr": NS(), "slug": S(), "developerName": NS(), "description": NS(), "descriptionEn": NS(), "coverImageUrl": NS(),
                     "latitude": N(nullable=True), "longitude": N(nullable=True), "region": ref("Place")}),
    "Project": obj({"id": S(), "kind": S(enum=["PARTNERSHIP", "COMPLETED"]), "name": S(), "nameAr": NS(), "slug": S(), "description": NS(), "descriptionEn": NS(),
                    "partnerName": NS(), "coverImageUrl": NS(), "completedAt": {**DT, "nullable": True}, "region": {"nullable": True, **obj({"name": S(), "nameAr": NS()})}}),
    "InquiryInput": obj({"propertyId": S(maxLength=40), "name": S(minLength=2, maxLength=100), "phone": S(description="Egyptian mobile (01…) or international", example="01012345678"),
                         "email": S(format="email"), "message": S(maxLength=2000), "locale": S(enum=["ar", "en"], default="ar", description="Language of the SMS confirmation"),
                         "website": S(maxLength=0, description="Honeypot — must be empty")}, ["name", "phone"]),
    "SubmissionInput": obj({"ownerName": S(minLength=2, maxLength=100), "phone": S(example="01012345678"), "propertyType": S(enum=PROPERTY_TYPES), "transaction": S(enum=["SALE", "RENT"]),
                            "location": S(maxLength=200), "details": S(maxLength=2000), "locale": S(enum=["ar", "en"]), "website": S(maxLength=0)}, ["ownerName", "phone"]),
    "Created": data(obj({"id": S()})),
    "Health": obj({"status": S(enum=["ok", "degraded"]), "instance": S(), "version": S(description="Release (git commit) this server runs"), "uptime": I(), "db": obj({"primary": S(), "latencyMs": I()}), "replica": {"type": "object"}, "cache": {"type": "object"}}),
    "PropertyInput": obj({"title": S(minLength=5, maxLength=160), "titleEn": NS(maxLength=160), "description": NS(maxLength=5000), "descriptionEn": NS(maxLength=5000),
                          "type": S(enum=PROPERTY_TYPES), "transaction": S(enum=["SALE", "RENT"]), "sellerType": NS(enum=["DEVELOPER", "RESALE"], description="Required for SALE; ignored for RENT"),
                          "price": N(exclusiveMinimum=True, minimum=0, maximum=10_000_000_000), "areaSqm": I(minimum=1), "bedrooms": I(nullable=True, minimum=0, maximum=50), "bathrooms": I(nullable=True, minimum=0, maximum=50),
                          "regionId": S(), "compoundId": NS(description="Must belong to the region"), "address": NS(maxLength=300), "latitude": N(nullable=True), "longitude": N(nullable=True),
                          "isFeatured": B, "publish": {**B, "description": "Create as ACTIVE instead of DRAFT (create only)"}}, ["title", "type", "transaction", "price", "areaSqm", "regionId"]),
    "AdminProperty": {"type": "object", "description": "Full listing record incl. status, expiry, media, audit fields."},
    "Inquiry": obj({"id": S(), "propertyId": NS(), "name": S(), "phone": S(), "email": NS(), "message": NS(), "status": S(enum=["NEW", "CONTACTED", "VIEWING", "OFFERED", "CLOSED", "SPAM"]),
                    "staffNote": NS(), "firstResponseAt": {**DT, "nullable": True}, "anonymizedAt": {**DT, "nullable": True}, "createdAt": DT, "property": {"nullable": True, **obj({"id": S(), "title": S()})}}),
    "Submission": obj({"id": S(), "ownerName": S(), "phone": S(), "propertyType": NS(), "transaction": NS(), "location": NS(), "details": NS(),
                       "status": S(enum=["NEW", "REVIEWED", "CONVERTED", "REJECTED"]), "staffNote": NS(), "anonymizedAt": {**DT, "nullable": True}, "createdAt": DT}),
    "MediaAsset": obj({"id": S(), "kind": S(enum=["IMAGE", "VIDEO"]), "status": S(enum=["PROCESSING", "READY", "FAILED"]), "url": S(), "variants": {"nullable": True, **ref("Variants")},
                       "posterUrl": NS(), "width": I(nullable=True), "height": I(nullable=True), "durationSec": N(nullable=True), "originalName": S(), "alt": NS(), "createdAt": DT, "deletedAt": {**DT, "nullable": True}}),
    "StaffUser": obj({"id": S(), "email": S(), "name": S(), "role": S(enum=ROLES), "status": S(enum=["ACTIVE", "SUSPENDED"]), "lastLoginAt": {**DT, "nullable": True},
                      "lockedUntil": {**DT, "nullable": True}, "mustChangePassword": B}),
    "Me": obj({"user": ref("StaffUser"), "permissions": arr(S()), "restriction": S(enum=["NONE", "PASSWORD_CHANGE"]), "security": {"type": "object"}}),
    "SignInResult": obj({"user": ref("StaffUser"), "permissions": arr(S()), "restriction": S(enum=["NONE", "PASSWORD_CHANGE"])}),
    "Session": obj({"id": S(), "ip": NS(), "userAgent": NS(), "createdAt": DT, "lastSeenAt": DT, "current": B}),
    "AuditEntry": obj({"id": S(), "action": S(example="property.update"), "entityType": S(), "entityId": NS(), "before": {"nullable": True}, "after": {"nullable": True},
                       "ip": NS(), "createdAt": DT, "actor": {"nullable": True, **obj({"name": S(), "email": S()})}}),
    "EmailConfig": obj({"enabled": B, "provider": S(enum=["sendgrid", "log"]), "fromEmail": S(format="email"), "fromName": S(), "staffRecipients": arr(S(format="email")),
                        "apiKey": S(description="Write-only; only when changing it. Read back masked.")}, ["enabled", "provider", "fromEmail", "fromName", "staffRecipients"]),
    "SmsConfig": obj({"enabled": B, "provider": S(enum=["twilio", "log"]), "accountSid": S(pattern="^AC[0-9a-fA-F]{32}$"), "fromNumber": S(), "messagingServiceSid": S(),
                      "customerAcknowledgements": B, "authToken": S(description="Write-only")}, ["enabled", "provider", "customerAcknowledgements"]),
    "Template": obj({"id": S(), "key": S(example="inquiry_customer_ack"), "channel": S(enum=["EMAIL", "SMS"]), "locale": S(enum=["ar", "en"]), "subject": NS(), "body": S(), "isActive": B, "variables": arr(S())}),
    "NotificationLog": obj({"id": S(), "channel": S(enum=["EMAIL", "SMS"]), "recipient": S(), "templateKey": NS(), "subject": NS(), "status": S(enum=["SENT", "FAILED", "SKIPPED"]),
                            "provider": S(), "error": NS(), "createdAt": DT}),
    "ReportSchedule": obj({"id": S(), "report": S(enum=["overview", "properties", "inquiries", "team"]), "frequency": S(enum=["WEEKLY", "MONTHLY"]), "format": S(enum=["csv", "xlsx"]),
                           "recipients": arr(S(format="email")), "isActive": B, "nextRunAt": DT, "lastRunAt": {**DT, "nullable": True}}),
    "PrivacySubject": obj({"phone": S(maxLength=30, description="Any format: 010…, +2010…, 002010…"), "email": S(format="email")}),
    "PrivacyPolicy": obj({"leadRetentionMonths": I(minimum=6, maximum=120), "logRetentionMonths": I(minimum=3, maximum=36)}, ["leadRetentionMonths", "logRetentionMonths"]),
    "RetentionRun": obj({"at": DT, "inquiries": I(), "submissions": I(), "notificationLogs": I(), "auditEntries": I(), "sessions": I(), "trigger": S(enum=["schedule", "manual"])}),
    "AllowList": obj({"enabled": B, "entries": arr(obj({"value": S(description="IPv4/IPv6 address or CIDR (≥ /8, ≥ /16 for IPv6)"), "label": NS()}, ["value"]))}, ["enabled", "entries"]),
    "Json": {"type": "object", "description": "See the admin screen that uses it; shape documented in the code."},
}

params = {
    "id": {"name": "id", "in": "path", "required": True, "schema": S(maxLength=40)},
    "mediaId": {"name": "mediaId", "in": "path", "required": True, "schema": S()},
    "slug": {"name": "slug", "in": "path", "required": True, "schema": S(maxLength=80)},
    "page": {"name": "page", "in": "query", "schema": I(minimum=1, default=1)},
    "pageSize": {"name": "pageSize", "in": "query", "schema": I(minimum=1, maximum=100)},
    "from": {"name": "from", "in": "query", "schema": S(format="date", example="2026-09-01"), "description": "Start date (Cairo). Default: 30 days ago."},
    "to": {"name": "to", "in": "query", "schema": S(format="date"), "description": "End date. Default: today."},
}
listing_filters = [
    ("type", S(description="One or more, comma-separated", example="APARTMENT,VILLA")), ("transaction", S(enum=["SALE", "RENT"])), ("seller", S(enum=["DEVELOPER", "RESALE"])),
    ("region", S(description="Region slug")), ("compound", S(description="Compound slug")), ("location", S(enum=["in", "out"], description="Inside / outside compounds")),
    ("minPrice", N()), ("maxPrice", N()), ("minArea", I()), ("maxArea", I()), ("bedrooms", I(description="At least")), ("q", S(maxLength=100, description="Text search (title, address)")),
    ("featured", S(enum=["true"])), ("sort", S(enum=["newest", "price_asc", "price_desc", "area_desc"], default="newest")), ("page", I(minimum=1, maximum=1000, default=1)), ("pageSize", I(minimum=1, maximum=48, default=12)),
]
for n, sch in listing_filters:
    params[f"f_{n}"] = {"name": n, "in": "query", "schema": sch}
FILTERS = [{"$ref": f"#/components/parameters/f_{n}"} for n, _ in listing_filters]
P = lambda *names: [{"$ref": f"#/components/parameters/{n}"} for n in names]

ERR = {c: {"description": d, "content": {"application/json": {"schema": ref("Error")}}} for c, d in {
    "400": "Invalid input (field messages in error.details)", "401": "Not signed in, or the session ended", "403": "Not allowed (role, origin, IP allowlist or a required step: code PASSWORD_CHANGE_REQUIRED)",
    "404": "Not found", "409": "Conflict (e.g. in use)", "413": "Body or file too large", "423": "Account locked after repeated failures", "429": "Too many requests"}.items()}
ok = lambda schema, desc="OK": {"description": desc, "content": {"application/json": {"schema": schema}}}
NOC = {"description": "Done (no content)"}

paths = {}
def op(method, path, tag, summary, *, auth=True, perm=None, params_=None, body=None, resp=None, status="200", errors=("400",), desc=None, extra=None):
    o = {"tags": [tag], "summary": summary, "operationId": re.sub(r"[^a-zA-Z0-9]+", "_", f"{method}_{path}").strip("_")}
    d = []
    if desc: d.append(desc)
    if perm: d.append(f"**Permission:** `{perm}`.")
    if d: o["description"] = "\n\n".join(d)
    if perm: o["x-permission"] = perm
    if not auth: o["security"] = []
    if params_: o["parameters"] = params_
    if body is not None:
        o["requestBody"] = {"required": True, "content": {"application/json": {"schema": body}}} if not isinstance(body, dict) or "content" not in body else body
    r = {status: resp if resp is not None else (NOC if status == "204" else ok(ref("Json")))}
    codes = list(errors) + (["401", "403"] if auth else [])
    for c in codes: r[c] = {"$ref": f"#/components/responses/E{c}"}
    o["responses"] = r
    if extra: o.update(extra)
    paths.setdefault(path, {})[method] = o

# ───────────── Public ─────────────
T = "Public — listings"
op("get", "/api/properties", T, "Search listings", auth=False, params_=FILTERS, resp=ok(paged(ref("PropertyCard"))), desc="Active, unexpired listings. Cached (see docs/operations/PERFORMANCE.md).")
op("get", "/api/properties/summary", T, "Starting price and count per property type", auth=False, params_=FILTERS, resp=ok(data(arr(ref("TypeSummary")))))
op("get", "/api/properties/map", T, "Listings with coordinates (max 2,000)", auth=False, params_=FILTERS, resp=ok(data(arr(ref("MapPoint")))))
op("get", "/api/properties/{id}", T, "One listing", auth=False, params_=P("id"), resp=ok(data(ref("PropertyDetail"))), errors=("400", "404"))
op("post", "/api/properties/{id}/view", T, "Count a view (sent by the listing page from the browser)", auth=False, params_=P("id"), status="204", errors=("400", "429"),
   desc="Bots and repeat views (same visitor and listing within 30 minutes) are ignored.")
T = "Public — catalog"
op("get", "/api/regions", T, "Regions", auth=False, resp=ok(data(arr(ref("Region")))))
op("get", "/api/compounds", T, "Compounds with available units and starting prices", auth=False, resp=ok(data(arr(ref("CompoundSummary")))))
op("get", "/api/compounds/{slug}", T, "One compound", auth=False, params_=P("slug"), resp=ok(data(ref("Compound"))), errors=("400", "404"))
op("get", "/api/projects", T, "Partnership and completed projects", auth=False, params_=[{"name": "kind", "in": "query", "schema": S(enum=["PARTNERSHIP", "COMPLETED"])}], resp=ok(data(arr(ref("Project")))))
op("get", "/api/sitemap", T, "Pages for search engines (listing ids and compound slugs with last-change dates)", auth=False, errors=(),
   resp=ok(data(obj({"properties": arr(obj({"id": S(), "updatedAt": S(format="date-time")})), "compounds": arr(obj({"slug": S(), "updatedAt": S(format="date-time")}))}))),
   desc="Used by the website's /sitemap.xml. At most 22,500 listings (newest changes first).")
T = "Public — leads"
op("post", "/api/inquiries", T, "Ask about a listing (call-back request)", auth=False, body=ref("InquiryInput"), resp=ok(ref("Created"), "Received"), status="201", errors=("400", "404", "413", "429"),
   desc="Rate-limited (10 per hour per address at the API, 5 per minute at nginx). Staff are emailed; the visitor gets an SMS confirmation when enabled.")
op("post", "/api/submissions", T, "Ask to list a property (owners)", auth=False, body=ref("SubmissionInput"), resp=ok(ref("Created"), "Received"), status="201", errors=("400", "413", "429"))
T = "Health"
for p_, s_ in [("/api/health", "Readiness through the load balancer"), ("/health", "Readiness (database reachable)"), ("/health/ready", "Readiness"), ("/health/live", "Liveness (process up; no database)")]:
    op("get", p_, T, s_, auth=False, resp=ok(ref("Health")), errors=(), extra={"responses": {"200": ok(ref("Health")), "503": {"description": "Database unreachable"}}})

# ───────────── Admin: auth ─────────────
T = "Admin — sign-in & account"
op("post", "/api/admin/auth/login", T, "Sign in (email + password)", auth=False, body=obj({"email": S(format="email"), "password": S()}, ["email", "password"]), resp=ok(ref("SignInResult")), errors=("400", "401", "403", "423", "429"),
   desc="Sets the session cookies.")
op("post", "/api/admin/auth/refresh", T, "Renew the access cookie", auth=False, status="204", errors=("401",))
op("post", "/api/admin/auth/logout", T, "Sign out this browser", auth=False, status="204", errors=())
op("get", "/api/admin/auth/me", T, "Who am I (permissions, required steps)", resp=ok(data(ref("Me"))), errors=())
op("post", "/api/admin/auth/password", T, "Change my password", body=obj({"currentPassword": S(), "newPassword": S(minLength=12, maxLength=128)}, ["currentPassword", "newPassword"]), errors=("400", "423"),
   desc="Password policy: 12+ characters, upper/lower case, number, symbol, no common or personal words. Signs out the other browsers.")
op("get", "/api/admin/auth/sessions", T, "My signed-in browsers", resp=ok(data(arr(ref("Session")))), errors=())
op("delete", "/api/admin/auth/sessions/{id}", T, "Sign out one of my browsers", params_=P("id"), status="204", errors=("404",))
op("post", "/api/admin/auth/sessions/revoke-others", T, "Sign out all my other browsers", resp=ok(data(obj({"ended": I()}))), errors=())

# ───────────── Admin: listings & media ─────────────
T = "Admin — listings"
op("get", "/api/admin/properties", T, "Listings table (all statuses)", perm="property:read", params_=FILTERS + [{"name": "status", "in": "query", "schema": S(enum=["DRAFT", "ACTIVE", "EXPIRED", "SOLD", "ARCHIVED"])}], resp=ok(paged(ref("AdminProperty"))))
op("post", "/api/admin/properties", T, "Create a listing", perm="property:write", body=ref("PropertyInput"), resp=ok(data(ref("AdminProperty")), "Created"), status="201")
op("get", "/api/admin/properties/{id}", T, "One listing with media and history fields", perm="property:read", params_=P("id"), resp=ok(data(ref("AdminProperty"))), errors=("404",))
op("patch", "/api/admin/properties/{id}", T, "Edit a listing", perm="property:write", params_=P("id"), body={"allOf": [ref("PropertyInput")], "description": "Any subset of the fields (publish not allowed here)."}, resp=ok(data(ref("AdminProperty"))), errors=("400", "404"))
op("post", "/api/admin/properties/{id}/lifecycle", T, "Publish, renew, expire, mark sold, archive or unpublish", perm="property:lifecycle", params_=P("id"),
   body=obj({"action": S(enum=["publish", "renew", "expire", "mark_sold", "archive", "unpublish"])}, ["action"]), resp=ok(data(ref("AdminProperty"))), errors=("400", "404", "409"))
op("delete", "/api/admin/properties/{id}", T, "Delete a listing (soft delete)", perm="property:delete", params_=P("id"), status="204", errors=("404",))
op("post", "/api/admin/properties/{id}/media", T, "Upload photos/videos to a listing (multipart, field 'files')", perm="property:write", params_=P("id"),
   body={"required": True, "content": {"multipart/form-data": {"schema": obj({"files": arr(S(format="binary"))})}}}, errors=("400", "404", "413"),
   desc="Up to 20 files; images ≤ 15 MB (JPEG/PNG/WebP, converted to WebP), videos ≤ 95 MB (MP4/MOV/WebM).")
op("post", "/api/admin/properties/{id}/media/attach", T, "Attach existing media-library items", perm="property:write", params_=P("id"), body=obj({"assetIds": arr(S())}, ["assetIds"]), errors=("400", "404"))
op("post", "/api/admin/properties/{id}/media/{mediaId}/cover", T, "Make a photo the cover", perm="property:write", params_=P("id", "mediaId"), errors=("404",))
op("delete", "/api/admin/properties/{id}/media/{mediaId}", T, "Remove a photo/video from the listing", perm="property:write", params_=P("id", "mediaId"), status="204", errors=("404",))
T = "Admin — media library"
op("get", "/api/admin/media", T, "Media library", perm="media:read", params_=[{"name": "kind", "in": "query", "schema": S(enum=["IMAGE", "VIDEO"])}, {"name": "unused", "in": "query", "schema": S(enum=["true"])},
   {"name": "deleted", "in": "query", "schema": S(enum=["true"])}, {"name": "q", "in": "query", "schema": S()}] + P("page", "pageSize"), resp=ok(paged(ref("MediaAsset"))))
op("post", "/api/admin/media/upload", T, "Upload to the library (optionally straight onto a listing)", perm="media:write", params_=[{"name": "propertyId", "in": "query", "schema": S()}],
   body={"required": True, "content": {"multipart/form-data": {"schema": obj({"files": arr(S(format="binary"))})}}}, resp=ok(data(arr(ref("MediaAsset"))), "Uploaded"), status="201", errors=("400", "413"))
op("patch", "/api/admin/media/{id}", T, "Set the description (alt text)", perm="media:write", params_=P("id"), body=obj({"alt": NS(maxLength=200)}, ["alt"]), resp=ok(data(ref("MediaAsset"))), errors=("400", "404"))
op("delete", "/api/admin/media/{id}", T, "Delete (restorable for 30 days); ?force=true if used by listings", perm="media:write", params_=P("id") + [{"name": "force", "in": "query", "schema": S(enum=["true"])}], status="204", errors=("404", "409"))
op("post", "/api/admin/media/{id}/restore", T, "Restore a deleted item", perm="media:write", params_=P("id"), resp=ok(data(ref("MediaAsset"))), errors=("404",))

# ───────────── Admin: leads ─────────────
T = "Admin — leads"
op("get", "/api/admin/inquiries", T, "Inquiries", perm="inquiry:read", params_=[{"name": "status", "in": "query", "schema": S(enum=["NEW", "CONTACTED", "VIEWING", "OFFERED", "CLOSED", "SPAM"])}] + P("page", "pageSize"), resp=ok(paged(ref("Inquiry"))))
op("patch", "/api/admin/inquiries/{id}", T, "Update status / staff note", perm="inquiry:write", params_=P("id"), body=obj({"status": S(enum=["NEW", "CONTACTED", "VIEWING", "OFFERED", "CLOSED", "SPAM"]), "staffNote": NS(maxLength=2000)}), resp=ok(data(ref("Inquiry"))), errors=("400", "404"))
op("get", "/api/admin/submissions", T, "Property requests (owners)", perm="submission:read", params_=[{"name": "status", "in": "query", "schema": S(enum=["NEW", "REVIEWED", "CONVERTED", "REJECTED"])}] + P("page", "pageSize"), resp=ok(paged(ref("Submission"))))
op("patch", "/api/admin/submissions/{id}", T, "Update status / staff note", perm="submission:write", params_=P("id"), body=obj({"status": S(enum=["NEW", "REVIEWED", "CONVERTED", "REJECTED"]), "staffNote": NS(maxLength=2000)}), resp=ok(data(ref("Submission"))), errors=("400", "404"))

# ───────────── Admin: catalog ─────────────
T = "Admin — regions, compounds & projects"
region_in = obj({"name": S(minLength=2, maxLength=80), "nameAr": NS(maxLength=80), "sortOrder": I(), "isActive": B}, ["name"])
compound_in = obj({"name": S(minLength=2, maxLength=120), "nameAr": NS(), "developerName": NS(), "description": NS(), "descriptionEn": NS(), "regionId": S(), "latitude": N(nullable=True), "longitude": N(nullable=True),
                   "coverImageUrl": NS(format="uri"), "isPublished": B, "sortOrder": I()}, ["name", "regionId"])
project_in = obj({"kind": S(enum=["PARTNERSHIP", "COMPLETED"]), "name": S(minLength=2, maxLength=160), "nameAr": NS(), "description": NS(), "descriptionEn": NS(), "partnerName": NS(), "regionId": NS(),
                  "coverImageUrl": NS(format="uri"), "completedAt": {**DT, "nullable": True}, "isPublished": B, "sortOrder": I()}, ["kind", "name"])
for name, schema, can_delete in [("regions", region_in, False), ("compounds", compound_in, True), ("projects", project_in, True)]:
    op("get", f"/api/admin/catalog/{name}", T, f"List {name}", perm="property:read", resp=ok(data(arr(ref("Json")))), errors=())
    op("post", f"/api/admin/catalog/{name}", T, f"Create one of the {name}", perm="catalog:write", body=schema, resp=ok(data(ref("Json")), "Created"), status="201", errors=("400", "409"))
    op("patch", f"/api/admin/catalog/{name}/{{id}}", T, f"Edit one of the {name}", perm="catalog:write", params_=P("id"), body={"allOf": [schema], "description": "Any subset of the fields."}, resp=ok(data(ref("Json"))), errors=("400", "404", "409"))
    if can_delete:
        op("delete", f"/api/admin/catalog/{name}/{{id}}", T, f"Delete one of the {name}", perm="catalog:write", params_=P("id"), status="204", errors=("404", "409"))

# ───────────── Admin: team, security, privacy ─────────────
T = "Admin — team"
op("get", "/api/admin/team", T, "Staff accounts", perm="team:manage", resp=ok(data(arr(ref("StaffUser")))), errors=())
op("post", "/api/admin/team", T, "Add a staff member (temporary password)", perm="team:manage", body=obj({"email": S(format="email"), "name": S(), "role": S(enum=ROLES), "password": S(description="Temporary; they must replace it at first sign-in")}, ["email", "name", "role", "password"]),
   resp=ok(data(ref("StaffUser")), "Created"), status="201", errors=("400", "409"))
op("patch", "/api/admin/team/{id}", T, "Change name, role, status or set a temporary password (signs them out)", perm="team:manage", params_=P("id"),
   body=obj({"name": S(), "role": S(enum=ROLES), "status": S(enum=["ACTIVE", "SUSPENDED"]), "password": S()}), resp=ok(data(ref("StaffUser"))), errors=("400", "404"))
for action, s_ in [("unlock", "Unlock a locked account"), ("sign-out", "Sign someone out on every browser")]:
    op("post", f"/api/admin/team/{{id}}/{action}", T, s_, perm="team:manage", params_=P("id"), errors=("400", "404"))
T = "Admin — security"
op("get", "/api/admin/security/overview", T, "Security overview (staff, locks, config checks, recent events)", perm="security:manage", errors=())
op("get", "/api/admin/security/sessions", T, "Everyone signed in now", perm="security:manage", errors=())
op("delete", "/api/admin/security/sessions/{id}", T, "End someone's session", perm="security:manage", params_=P("id"), status="204", errors=("404",))
op("get", "/api/admin/security/ip-allowlist", T, "Allowed networks for the admin", perm="security:manage", resp=ok(data(ref("AllowList"))), errors=())
op("put", "/api/admin/security/ip-allowlist", T, "Change allowed networks (refused if it would lock you out)", perm="security:manage", body=ref("AllowList"), resp=ok(data(ref("AllowList"))), errors=("400",))
T = "Admin — privacy"
op("get", "/api/admin/privacy/overview", T, "Retention policy, last clean-up, counts", perm="privacy:manage", errors=())
op("put", "/api/admin/privacy/policy", T, "Change retention periods", perm="privacy:manage", body=ref("PrivacyPolicy"), resp=ok(data(ref("PrivacyPolicy"))))
op("post", "/api/admin/privacy/retention/run", T, "Run the personal-data clean-up now", perm="privacy:manage", resp=ok(data(ref("RetentionRun"))), errors=())
op("post", "/api/admin/privacy/lookup", T, "Find everything held about one person", perm="privacy:manage", body=ref("PrivacySubject"),
   desc="Phone numbers and emails are sent in the body (never the URL) so they don't reach access logs.")
op("post", "/api/admin/privacy/export", T, "Download a person's data (JSON attachment)", perm="privacy:manage", body=ref("PrivacySubject"))
op("post", "/api/admin/privacy/erase", T, "Erase a person's details everywhere (irreversible)", perm="privacy:manage",
   body={"allOf": [ref("PrivacySubject"), obj({"confirm": S(enum=["ERASE"])}, ["confirm"])]}, resp=ok(data(obj({"inquiries": I(), "submissions": I(), "notifications": I(), "pendingMessages": I(), "auditEntries": I()}))))

# ───────────── Admin: analytics, notifications, system ─────────────
T = "Admin — analytics & reports"
for p_, s_ in [("dashboard", "KPIs and 30-day series (views, inquiries, conversion)"), ("properties", "Listing performance"), ("inquiries", "Inquiry funnel and response times"), ("users", "Team activity")]:
    op("get", f"/api/admin/analytics/{p_}", T, s_, perm="analytics:read", params_=P("from", "to"))
op("post", "/api/admin/reports/generate", T, "Download a report (CSV or Excel)", perm="analytics:read",
   body=obj({"report": S(enum=["overview", "properties", "inquiries", "team"]), "from": S(format="date"), "to": S(format="date"), "format": S(enum=["csv", "xlsx"])}, ["report", "format"]),
   resp={"description": "The file", "content": {"text/csv": {"schema": S(format="binary")}, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"schema": S(format="binary")}}})
op("get", "/api/admin/reports/schedules", T, "Scheduled report emails", perm="analytics:read", resp=ok(data(arr(ref("ReportSchedule")))), errors=())
op("post", "/api/admin/reports/schedules", T, "Schedule a weekly/monthly report email", perm="analytics:read",
   body=obj({"report": S(enum=["overview", "properties", "inquiries", "team"]), "frequency": S(enum=["WEEKLY", "MONTHLY"]), "format": S(enum=["csv", "xlsx"]), "recipients": arr(S(format="email"))}, ["report", "frequency", "recipients"]),
   resp=ok(data(ref("ReportSchedule")), "Created"), status="201")
op("delete", "/api/admin/reports/schedules/{id}", T, "Stop a scheduled report", perm="analytics:read", params_=P("id"), status="204", errors=("404",))
T = "Admin — notifications"
op("get", "/api/admin/email-config", T, "Email provider settings (key masked)", perm="notifications:manage", resp=ok(data(ref("EmailConfig"))), errors=())
op("post", "/api/admin/email-config", T, "Save email provider settings", perm="notifications:manage", body=ref("EmailConfig"), resp=ok(data(ref("EmailConfig"))))
op("get", "/api/admin/sms-config", T, "SMS provider settings (token masked)", perm="notifications:manage", resp=ok(data(ref("SmsConfig"))), errors=())
op("post", "/api/admin/sms-config", T, "Save SMS provider settings", perm="notifications:manage", body=ref("SmsConfig"), resp=ok(data(ref("SmsConfig"))))
op("get", "/api/admin/notifications/templates", T, "Message templates (Arabic / English, email / SMS)", perm="notifications:manage", resp=ok(data(arr(ref("Template")))), errors=())
op("put", "/api/admin/notifications/templates/{id}", T, "Edit a template", perm="notifications:manage", params_=P("id"), body=obj({"subject": NS(maxLength=200), "body": S(maxLength=5000), "isActive": B}, ["body"]), resp=ok(data(ref("Template"))), errors=("400", "404"))
op("post", "/api/admin/notifications/templates/preview", T, "Preview a template with sample values", perm="notifications:manage",
   body=obj({"subject": S(), "body": S(), "channel": S(enum=["EMAIL", "SMS"]), "vars": {"type": "object", "additionalProperties": S()}}, ["body", "channel"]))
op("post", "/api/admin/notifications/test", T, "Send a test email/SMS", perm="notifications:manage", body=obj({"channel": S(enum=["EMAIL", "SMS"]), "to": S()}, ["channel", "to"]), errors=("400", "429"))
op("get", "/api/admin/notifications/logs", T, "Delivery log", perm="notifications:manage", params_=[{"name": "channel", "in": "query", "schema": S(enum=["EMAIL", "SMS"])}, {"name": "status", "in": "query", "schema": S(enum=["SENT", "FAILED", "SKIPPED"])}] + P("page", "pageSize"), resp=ok(paged(ref("NotificationLog"))))
op("get", "/api/admin/jobs", T, "Background job counts and recent failures", perm="notifications:manage", errors=())
op("post", "/api/admin/jobs/{id}/retry", T, "Retry a failed job", perm="notifications:manage", params_=P("id"), errors=("404", "409"))
T = "Admin — system"
op("get", "/api/admin/dashboard", T, "Home screen numbers", perm="property:read", errors=())
op("get", "/api/admin/audit", T, "Activity log (append-only)", perm="audit:read", params_=[{"name": n, "in": "query", "schema": S()} for n in ("entityType", "entityId", "actorId", "action")] + P("page", "pageSize"), resp=ok(paged(ref("AuditEntry"))))

spec = {
    "openapi": "3.0.3",
    "info": {
        "title": "Brookrege API", "version": "1.0.0",
        "description": (
            "REST API of the Brookrege real estate platform (Sohag, Egypt).\n\n"
            "**Public** endpoints (`/api/...`) serve the website: no sign-in, rate-limited, responses cached for up to 30 minutes and cleared on every admin change.\n\n"
            "**Admin** endpoints (`/api/admin/...`) are served only on the admin domain and need a signed-in staff session: HttpOnly cookies set by "
            "`/auth/login`. Requests must come from the admin app's origin (Origin / Sec-Fetch-Site checked), and may be limited "
            "to allowed networks. Each endpoint lists the permission it needs; roles: SUPER_ADMIN (all), CONTENT_ADMIN (listings, catalog, media, leads, "
            "analytics), MODERATOR (leads, listing lifecycle).\n\n"
            "**Errors** always have the shape `{ \"error\": { \"code\", \"message\", \"details\"? } }` with a plain-English message.\n\n"
            "**Prices** are EGP. Written content is Arabic first (`title`), English optional (`titleEn`); place names are Latin (`name`) with an Arabic form (`nameAr`)."),
        "contact": {"name": "Brookrege technical team", "email": "security@brookrege.com"},
    },
    "servers": [{"url": "https://brookrege.com", "description": "Public site"}, {"url": "https://admin.brookrege.com", "description": "Admin (only /api/admin/*)"}, {"url": "http://localhost:4000", "description": "Local development"}],
    "security": [{"session": []}],
    "tags": [{"name": t} for t in dict.fromkeys(o["tags"][0] for ops in paths.values() for o in ops.values())],
    "paths": dict(sorted(paths.items())),
    "components": {
        "securitySchemes": {"session": {"type": "apiKey", "in": "cookie", "name": "__Host-bk_at", "description": "Short-lived access cookie (15 min), renewed with /api/admin/auth/refresh. Plain-HTTP local development uses bk_at."}},
        "parameters": params,
        "responses": {f"E{c}": v for c, v in ERR.items()},
        "schemas": schemas,
    },
}

def to_yaml(value, indent=0):
    """Small YAML writer (keeps key order; strings quoted with JSON rules, which YAML accepts)."""
    pad = "  " * indent
    if isinstance(value, dict):
        if not value: return "{}"
        lines = []
        for k, v in value.items():
            key = k if re.fullmatch(r"[A-Za-z0-9_$./{}-]+", k) and not k.startswith(("{", "$")) or k.startswith("/") else json.dumps(k)
            if k.startswith("$"): key = json.dumps(k)
            if isinstance(v, (dict, list)) and v:
                lines.append(f"{pad}{key}:\n{to_yaml(v, indent + 1)}")
            else:
                lines.append(f"{pad}{key}: {to_yaml(v, indent + 1)}")
        return "\n".join(lines)
    if isinstance(value, list):
        if not value: return "[]"
        out = []
        for v in value:
            if isinstance(v, dict) and v:
                inner = to_yaml(v, indent + 1).split("\n")
                out.append(f"{pad}- {inner[0].strip()}" + ("\n" + "\n".join(inner[1:]) if len(inner) > 1 else ""))
            else:
                out.append(f"{pad}- {to_yaml(v, indent + 1)}")
        return "\n".join(out)
    if isinstance(value, bool): return "true" if value else "false"
    if value is None: return "null"
    if isinstance(value, (int, float)): return json.dumps(value)
    return json.dumps(value, ensure_ascii=False)

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "openapi.yaml").write_text("# Generated by scripts/api/build_openapi.py — edit that file, then re-run it.\n" + to_yaml(spec) + "\n")
    html = (ROOT / "scripts/api/redoc.html").read_text().replace("__SPEC__", json.dumps(spec, ensure_ascii=False).replace("</", "<\\/"))
    (OUT / "index.html").write_text(html)
    n = sum(len(v) for v in paths.values())
    print(f"✓ {n} operations, {len(schemas)} schemas → docs/api/openapi.yaml, docs/api/index.html")

if __name__ == "__main__":
    main()

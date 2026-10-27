# Operations API contract

This document describes the live contract registered by `server/operations.ts`. All endpoints are root-host API endpoints, use authenticated cookies and the global CSRF/origin protections, and return JSON with no-store protection. Epoch values are seconds.

## Shared response rules

- Success responses contain real data under the envelope shown below.
- Validation and authorization failures use `{ "error": string, "code"?: string }`.
- Persistent decisions use `approved` / `rejected` in returned rows. The request aliases `approve` / `reject` are also accepted where noted for the current Admin UI.
- Identifiers for people accepted by recipient inputs are `C<number>` (for example, `C12`). User IDs returned by administrative rows remain numeric.
- No route uses HTTP `DELETE`. Revocation, ending, release, suspension, expiry, and reversal are explicit state changes.

## Authorization and fresh verification

| Capability | Required role | Fresh verification |
| --- | --- | --- |
| Review queue and review decisions | owner, manager (scoped), moderator | no |
| User, service, proxy-site, and notification operations | owner or manager, subject to scope | action-specific; role/assignment changes require fresh verification |
| Financial payment, points, reversal, and expense operations | owner or a manager with `financial=1` | yes |
| Settings, reserved names, transfers, content, economics, backup | owner | settings/names/transfers/content/backup: yes; economics: no |
| Report evidence | owner | yes, with a recorded justification |

Managers are constrained to their assigned users/sites. Moderators may review but cannot perform manager or owner operations. There is no administrative list or read route for ordinary private messages.

## Administration

### `GET /api/admin/overview`

Returns both `overview` and `metrics`; they contain the same snake-case metric object consumed by the Admin client:

```json
{
  "overview": {
    "total_users": 0,
    "new_registrations": null,
    "published_sites": 0,
    "pending_sites": 0,
    "review_requests": 0,
    "free_trials": 0,
    "subscriptions": 0,
    "payment_requests": 0,
    "referrals": 0,
    "treasury_points": 1000000000000,
    "transfers": 0,
    "resource_usage": null,
    "service_activity": null,
    "notifications": 0,
    "contact_requests": 0
  },
  "metrics": { "...": "same values" },
  "pendingReviews": 0,
  "unreadNotifications": 0,
  "requestedPayments": 0
}
```

Metrics that cannot be sourced honestly for the caller’s scope are `null`; they are not estimated. Moderators receive only queue-appropriate values.

### `GET /api/admin/users?q=&status=&limit=&offset=`

Returns `{ "users": User[], "offset": number, "limit": number }`. Each user includes account fields, `balance`, `subdomain`, `site_status`, and `deletion_request_status` where available. `pin_hash` is never returned.

### `POST /api/admin/users/:id/action`

The body always includes `action`. Supported request shapes and success envelopes are:

| Action | Request fields | Success response |
| --- | --- | --- |
| `role` | `{action:"role", role:"owner"|"manager"|"moderator"|"user", financial?:boolean}` | `{user}` |
| `assign` | `{action:"assign", managerId?:number|string|null}` or `{assignedTo?:number|string|null}` | `{assignedTo:number|null, assigned_to:number|null}` |
| `points` | `{action:"points", amount:number, reason?:string, idempotencyKey?:string}` | `{ledgerId, balance, idempotent, actor}` |
| `status` | `{action:"status", status:"active"|"suspended"}`; Admin aliases `approved` and `published` map to `active` | `{status:"active"|"suspended"}` |
| `grant` | `{action:"grant", days:number}` | `{entitlementUntil:number}` |
| `service` | `{action:"service", key, mode:"default"|"grant"|"granted"|"pause"|"suspended", untilAt?:number}` | `{service:{key,mode:"default"|"grant"|"suspended",untilAt}}` |
| `branding` | `{action:"branding", siteId?:string, enabled?:boolean}` or Admin form `{key:"platform_branding",mode:"inherit"}` | `{siteId, branding:boolean}` |

Point grants are ledgered and idempotent by the idempotency key; they are never a hidden balance update.

### Reviews

`GET /api/admin/reviews?status=pending&limit=50` returns `{ "reviews": Review[] }`. Every review contains immutable `snapshot`, `draft_version`, `base_version`, and a UI-friendly `diff`:

```json
{
  "diff": {
    "before": { "...": "published profile" },
    "after": { "...": "submitted snapshot" },
    "changes": [{ "field":"title", "before":"…", "after":"…" }]
  }
}
```

`POST /api/admin/reviews/:id/decision` accepts `{ "decision":"approve"|"reject"|"approved"|"rejected", "reason"?:string }`. Rejection requires a reason. It returns `{ "review": Review|null }`, with `status` persisted as `approved` or `rejected`.

Approval requires the review to remain pending, its immutable `base_version` to match the site’s current published version, and its `draft_version` to match the current draft. Database triggers repeat this CAS check and publish the immutable snapshot atomically. A stale review returns `409` with `code: "review_stale"`.

### Payments

`GET /api/admin/payments?status=&limit=50` returns `{ "payments": Payment[] }`. A row includes `receipt_id` and the Admin-compatible `receiptId`, but never fabricates a receipt URL.

`POST /api/admin/payments/:id/decision` accepts `{ "decision":"approve"|"reject"|"approved"|"rejected", "reason"?:string }` and returns `{ "payment": Payment|null }`. Approval or rejection is final; a repeat decision returns `409` (`payment_stale`).

`POST /api/admin/payments/:id/reverse` accepts `{ "justification": string }` and returns:

```json
{
  "reversal": {
    "id": "payment-reversal-…",
    "paymentId": "…",
    "entitlementBefore": 0,
    "entitlementAfter": 0,
    "referralRecovered": 0,
    "referralOutstanding": 0
  }
}
```

A reversal adds immutable reversal and entitlement-adjustment records, timestamps `payments.reversed_at`, and uses a compensating ledger movement for recoverable referral points. It does not overwrite a payment decision.

### Settings

`GET /api/admin/settings` returns a canonical collection plus convenient aliases:

```json
{
  "settings": [{"key":"lock","value":{"mode":"open","message":"","reason":""}}],
  "lock": {"mode":"open","message":"","reason":""},
  "platform_lock": {"mode":"open","message":"","reason":""},
  "bank": {},
  "bank_instructions": {},
  "season": {},
  "seasonal": {}
}
```

`PUT /api/admin/settings` accepts `{key,value}`. Accepted aliases are `platform_lock` → `lock`, `bank_instructions` → `bank`, and `seasonal` → `season`. For a bank update, `{key:"bank", instructions:…}` is accepted when `value` is absent. It returns `{setting, [canonicalKey], platform_lock?, bank_instructions?, seasonal?}`.

Lock modes accepted from the Admin UI are `open`, `home_closed`, `platform_closed`, `maintenance`, and `human_test`. The operations layer stores middleware-compatible modes (`home` and `private`) and serializes them back as Admin-compatible modes. Password hashes are never returned.

### Services, names, transfers, sites, and notifications

- `GET /api/admin/services` → `{services}`. `PUT /api/admin/services/:key` with `{enabled:boolean}` → `{service:{key,enabled}}`.
- `GET /api/admin/names` → `{names}`. `POST /api/admin/names` with `{name,kind?,reason}` → `{name:{name,kind,reason,active:true}}`. `POST /api/admin/names/:name/release` → `{name,active:false}`; technical reservations cannot be released.
- `GET /api/admin/transfers` → `{transfers}`. `POST /api/admin/transfers/:id/decision` accepts the same decision aliases and returns `{transfer}`; returned transfers also include `from_user` and `to_user` aliases.
- `POST /api/admin/sites` accepts `{email?,name?,draft,authorization}`. It returns `201` and `{site, handover}`. An omitted email creates only the authorized proxy draft (`handover:null`); a later `POST /api/admin/sites/:id/handover` with `{email}` returns `201` and `{handover}`.
- `POST /api/admin/notifications` accepts `{recipient,title,body}`. `recipient` can be `C<number>`, an array of C-numbers, `all`, or `role:manager|moderator|user|owner`. Broad targets are owner-only. Success is `201` with `{delivered,recipients}`.

### Audit, economics, expenses, and backup

- `GET /api/admin/audit?before=&limit=` → `{audit}` with decoded `detail` objects.
- `GET /api/admin/economics` → `{metrics,economics}`. `metrics` uses the Admin client’s snake-case fields such as `active_users`, `approved_revenue`, and `operating_profitability`; unavailable provider usage values are `null`.
- `POST /api/admin/expenses` accepts `{amount,description?,label?,notes?}` and returns `201` with `{expense:{id,amount,description,notes,createdAt,created_at}}`.
- `GET /api/admin/backup` is owner-only and fresh-verified. It returns `{status:"ready",format,generatedAt,createdAt,excluded,restoration,tables}`. Authentication/session secrets, hashes, and private communication tables are excluded from this ordinary administrative export.

## Content

`GET /api/content/:slug` returns direct content fields for the public client and a compatibility envelope:

```json
{
  "slug":"privacy",
  "title_ar":"…",
  "title_en":"…",
  "body_ar":"…",
  "body_en":"…",
  "status":"published",
  "updated_at":0,
  "content": { "same": "fields" }
}
```

`PUT /api/admin/content/:slug` accepts either explicit bilingual fields (`titleAr`, `titleEn`, `bodyAr`, `bodyEn`, `status?`) or the Admin editor envelope `{content:{title_ar,title_en,body_ar,body_en,status?}}`. A plain string `content` is applied to both bodies only when the current titles remain available. Success returns `{content:{slug,title_ar,title_en,body_ar,body_en,status,updated_at}}`.

## Communications

- `GET /api/messages` → `{requests,conversations,blocks}` for the authenticated participant only. Expired active sessions are marked expired before listing.
- `POST /api/contact/request` with `{recipient:"C12"}` → `201 {request:{id,recipient,status:"pending",createdAt}}`. The recipient must have an active published site with contact enabled. One pending and one active pair session are enforced; expired sessions cannot be reused.
- `POST /api/contact/:id/decision` with `{accept:boolean}` → `{requestId,status:"accepted"|"rejected",conversationId:string|null}`. Acceptance is recipient-only and creates one active 24-hour session.
- `GET /api/conversations/:id` → `{conversation,messages}` only for a participant.
- `POST /api/conversations/:id/messages` with `{body}` → `201 {message:{id,conversationId,senderId,body,createdAt}}`. It rejects ended, expired, or blocked sessions.
- `POST /api/conversations/:id/end` → `{conversationId,status:"ended"}`.
- `POST /api/blocks` with `{userId}` → `{block:{userId,blockedId,createdAt},conversationsEnded:true}`. It ends active sessions and cancels pending requests for the pair.
- `POST /api/reports` with `{conversationId,reason,evidence?}` → `201 {report:{id,conversationId,status:"pending",createdAt}}`.
- `GET /api/admin/reports/:id/evidence?justification=…` is the only administrative evidence route. It requires owner + fresh verification and emits an audit event. It returns the specifically reported evidence only; it is not a general message-reading endpoint.
- `POST /api/notifications/:id/read` → `{id,read:true}` for the notification owner only.

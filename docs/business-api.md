# Business API reference

This document covers the authenticated business routes registered by `server/business.ts`. All timestamps are Unix epoch **seconds**. User identifiers returned to clients use `C{id}`. Successful responses contain real data; business validation failures use:

```json
{ "error": "Human-readable message", "code": "OPTIONAL_MACHINE_CODE" }
```

All write endpoints require the platform CSRF protections described in `docs/contracts.md`.

## `GET /api/dashboard`

Returns the Dashboard bootstrap payload:

```ts
{
  sites: Site[];
  reviews: Review[];
  wallet: { balance: number };
  ledger: LedgerEntry[];
  payments: Payment[];
  services: Service[];
  notifications: Notification[];
  analytics: Record<string, AnalyticsSummary>; // keyed by site id
  quickLinks: QuickLink[];                     // unexpired links for this user
  transfers: NameTransfer[];                   // pending transfers addressed to this user
  handovers: Handover[];                       // pending handovers addressed to this email
  user: DashboardUser;
}
```

`Site` fields are `id`, `name`, `userId`, `managerId`, `draft`, `draft_version`, `draftVersion`, `published`, `published_version`, `publishedVersion`, `status`, `lock` (`{enabled,message}`), `searchable`, `allowContact`, `branding`, `createdAt`, `updatedAt`, and `authorization`. The snake_case version fields are consumed by the current Dashboard; the camelCase aliases are retained for compatibility.

`Review` fields are `id`, `site_id`, `siteId`, `user_id`, `userId`, `snapshot`, `draft_version`, `draftVersion`, `base_version`, `baseVersion`, `status`, `kind`, `reviewer_id`, `reviewerId`, `reason`, `created_at`, `createdAt`, `decided_at`, and `decidedAt`.

`LedgerEntry` fields are `id`, `from_id`, `fromId`, `to_id`, `toId`, `amount`, `kind`, `notes`, `created_at`, `createdAt`, `reference`, `counterparty_id`, `counterpartyId`, `counterparty_name`, and `counterpartyName`.

`Payment` fields are `id`, `amount`, `days`, `receipt_id`, `receiptId`, `status`, `notes`, `created_at`, `createdAt`, `approved_at`, `approvedAt`, `reversed_at`, and `reversedAt`.

`Service` fields are `key`, `name_ar`, `name_en`, `nameAr`, `nameEn`, `enabled`, `premium`, `entitled`, `until_at`, `policy`, and `override`. `override` is `null` or `{mode,untilAt}`. `entitled` is the evaluated user eligibility after trial, entitlement, grant, and suspension state; it does not replace server-side enforcement.

`Notification` fields are `id`, `title`, `body`, `read_at`, `readAt`, `created_at`, and `createdAt`.

Each `AnalyticsSummary` has `visits`, `contactClicks`, `vcardDownloads`, `qrInteractions`, `total`, and `last7Days`. Counts cover the most recent 30 days except `last7Days`.

Each `QuickLink` has `id`, `url`, `fields`, `expires_at`, `expiresAt`, `created_at`, `createdAt`, and `revoked`.

Each dashboard `NameTransfer` has `id`, `name`, `from_id`, `to_id`, `status`, `created_at`, and `accepted_at`. Each dashboard `Handover` has `id`, `site_id`, `status`, `creator_id`, and `created_at`.

`DashboardUser` has `id`, `email`, `name`, `whatsapp`, `role`, `status`, `trial_until`, `entitlement_until`, and `balance`.

## Names and sites

### `GET /api/names/check?name={name}`

Returns `{name, valid, available, reason, suggestions}`. `reason` is a string or `null`; `suggestions` is a string array.

### `POST /api/names/reserve`

Request: `{name}`. On creation returns HTTP 201:

```ts
{ name: string; site: Site; createdAt: number }
```

### `GET /api/sites/:id`

Returns `{site: Site}`.

### `PUT /api/sites/:id/draft`

Request: `{draft: Profile, version: number}`. Returns:

```ts
{ site: Site; version: number; savedAt: number }
```

A stale `version` returns `409 DRAFT_CONFLICT` and never overwrites the newer draft.

### `POST /api/sites/:id/submit`

Returns HTTP 201: `{review: Review}`. The review contains an immutable snapshot and does not publish the site.

### `POST /api/sites/:id/lock`

Request: `{enabled:boolean, password?:string, message?:string}`. Returns:

```ts
{ lock: { enabled: boolean; message: string }; updatedAt: number }
```

### `POST /api/sites/:id/redirect`

Request: `{url}`. Returns HTTP 201: `{review: Review, redirect: string}`.

## Services, wallet, and payments

### `GET /api/services`

Returns `{services: Service[]}` using the `Service` fields above.

### `POST /api/wallet/transfer`

Request:

```ts
{ recipient: string; amount: number; idempotencyKey: string } // UUID key
```

`recipient` may be a `C{id}`, exact account name, exact owned profile name, or email. Ambiguous names are rejected. A new transfer returns HTTP 201:

```ts
{
  transfer: { id: string; recipient: string; amount: number; reference: string; createdAt: number };
  idempotent: false;
}
```

A successful replay returns the same `transfer` shape with `idempotent: true`. The same key cannot be replayed with a different amount. The transfer and both notifications are in one D1 batch; the ledger trigger rejects insufficient balance before any committed movement.

### `POST /api/wallet/redeem`

Request: `{days:number, idempotencyKey:string}` where the key is a UUID. Returns HTTP 201 for a new redemption, or HTTP 200 for a replay:

```ts
{
  redemption: { id: string; days: number; cost: number; createdAt: number };
  entitlementUntil: number;
  idempotent: boolean;
}
```

`cost` is `days * 100`. The same key with different `days` is rejected. The database redemption trigger debits the ledger and advances entitlement in the same SQLite statement, so points are never debited without the entitlement effect.

### `GET /api/payments/instructions`

When official intake is configured, returns:

```json
{
  "available": true,
  "instructions": {
    "beneficiary": "شركة رجال الوطن",
    "iban": "SA5380000296608010947219",
    "account": "296000010006080947219"
  }
}
```

No bank name is fabricated or returned. When intake is inactive, the response is `{available:false, instructions:null, reason:string}`.

### `POST /api/payments`

Request: `{amount:number, days:number, receiptId:string, notes?:string}`. `receiptId` is required and must reference the caller's private receipt file. A new request returns HTTP 201; a network/concurrency replay using the same caller-owned receipt returns HTTP 200:

```ts
{
  payment: {
    id: string;
    amount: number;
    days: number;
    receipt_id: string;
    receiptId: string;
    status: 'submitted' | string;
    notes: string;
    created_at: number;
    createdAt: number;
  };
  idempotent: boolean;
}
```

One receipt may substantiate only one payment for its owner. Reusing it with different payment content returns `409 IDEMPOTENCY_CONFLICT`. Approval remains an administrative operation; the existing payment database trigger applies paid entitlement and a qualifying one-time referral reward atomically with that approval.

## Quick links

### `POST /api/quick-links`

Request: `{fields: Array<'name'|'title'|'whatsapp'|'email'|'site'>, expiresDays:number}`. Returns HTTP 201 directly as `QuickLink` (not wrapped):

```ts
{
  id: string;
  url: string;
  fields: string[];
  expires_at: number;
  expiresAt: number;
  created_at: number;
  createdAt: number;
  revoked: false;
}
```

### `POST /api/quick-links/:id/revoke`

Returns `{id, revoked:true}`. The link record is soft-revoked.

## Name transfers and handovers

### `POST /api/names/transfer`

Request: `{name, recipient}`. Returns HTTP 201:

```ts
{ transfer: { id: string; name: string; recipient: string; status: 'pending'; createdAt: number } }
```

The name transfer never transfers the former owner's profile, media, or QR content.

### `POST /api/names/transfers/:id/accept`

Returns:

```ts
{ transfer: { id: string; name: string; status: 'accepted'; acceptedAt: number } }
```

### `POST /api/handovers/:id/accept`

Returns:

```ts
{
  handover: {
    id: string;
    siteId: string;
    status: 'accepted';
    acceptedAt: number;
    owner: string;
    manager: string;
  }
}
```

The target must be the currently authenticated verified email and can only accept one primary personal site.

## Other user routes

### `POST /api/deletion-request`

Request: `{reason?:string}`. Returns HTTP 201 for a new request or HTTP 200 for the current pending request:

```ts
{ request: { id: string; status: 'pending'; createdAt: number }; idempotent: boolean }
```

### `GET /api/analytics`

Returns:

```ts
{
  siteId: string | null;
  periodDays: 30;
  events: {
    visits: number;
    contactClicks: number;
    vcardDownloads: number;
    qrInteractions: number;
    total: number;
    byEvent: Record<string, number>;
  };
  activity: { last7Days: number; last30Days: number };
  quality: { score: number; recommendations: string[]; completed: string[] };
}
```

For a user with no site, `siteId` is `null` and all event counts are zero.

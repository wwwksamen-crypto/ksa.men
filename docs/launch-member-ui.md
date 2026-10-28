# Member UI launch contracts

This document records the client-side launch behavior implemented in `client/src/Dashboard.tsx` and `client/src/dashboard.css`. It does not change server APIs.

## First member reservation: step 1 → step 2

A dashboard with no active site on the Editor route presents only the concise name-reservation flow. The normal console navigation, editor section groups, preview, and save actions are withheld until a site exists. After a successful reservation, the returned site is opened and the member enters the normal editor as step 2.

- `GET /api/names/check?name={name}` is called after a short input delay. The client reads `{ name, valid, available, reason, suggestions }`.
- `POST /api/names/reserve` sends `{ name }` and expects `{ name, site, createdAt }`.
- Labels are checked locally with `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`: 1–63 lowercase ASCII letters/numbers, with hyphens only internally. Consecutive internal hyphens (for example `team--ksa`) are valid.
- The visible canonical address is always `<label>.ksa.men`. The client never sends a domain or URL to either name endpoint.
- **Reserve & create** is disabled until the current check reports `valid: true` and `available: true`, and throughout the reservation request.
- A reservation `409` (or equivalent authoritative name-conflict response) refreshes the dashboard. This recovers a successful concurrent request from another session for the same member by loading/opening its returned site; otherwise the advisory remains unavailable.

## Public site link

`Site.name` is a bare DNS label. The Dashboard public link validates it as a name label and opens exactly `https://<label>.ksa.men`; it never opens `https://<label>` or trusts an arbitrary URL.

## Wallet mutation safety

Transfers and entitlement redemptions use separate durable local retry records:

- `ksa-men:wallet-idempotency:transfer`
- `ksa-men:wallet-idempotency:redeem`

Each record contains a UUID idempotency key and a signature of the current operation payload. Repeating the exact operation after an ambiguous browser-network failure reuses the same key. Both action controls and inputs disable while either wallet mutation is in flight. A definitive API response error clears the operation’s stored key; a successful response clears it after server acknowledgement.

The request bodies remain unchanged:

- `POST /api/wallet/transfer` → `{ recipient, amount, idempotencyKey }`
- `POST /api/wallet/redeem` → `{ days, idempotencyKey }`

## Conversation blocking

Conversation detail does not always include peer identity. When opening detail, the Dashboard preserves the list item’s `other_user` ID/name whenever detail omits either value. The existing `POST /api/blocks { userId }` action can therefore still block the conversation peer.

## Receipts and bank intake

`POST /api/upload` accepts receipt uploads without a site. The Dashboard omits `siteId` only for `purpose: 'receipt'`; profile media still requires an active site. Receipt failures are shown in the subscription UI as well as through the normal notification channel.

`GET /api/payments/instructions` is interpreted as:

```ts
type PaymentInstructionsResult = {
  available?: boolean;
  instructions?: unknown;
  reason?: unknown;
};
```

Submission is enabled only when `available === true`. If inactive or not loaded, the disabled submit button has an explanatory reason and no payment request is sent. Bank details are rendered as display fields, never raw JSON.

## Transferred unbound names

The business contract exposes unbound transferred names in the dashboard payload:

```ts
type DashboardData = {
  unboundNames?: Array<{ name: string }>;
};
```

For every valid unbound label, Settings offers attachment:

```ts
POST /api/names/:name/attach
{ siteId: existingOwnSiteId | null }
```

The client sends a selected dashboard site ID when one exists. With no owned site it sends `{ siteId: null }`, relying on the confirmed business behavior to create the first site from the owned unbound name under the server’s existing site limit. A successful response may include `{ site?: Site }`; the Dashboard opens it when present and always refreshes the dashboard afterwards.

## Scope

Only the Dashboard component, its Dashboard stylesheet, and this launch contract document are part of this member UI change. No production calls, browser checks, server/API edits, deployment, or Git publishing are performed by this work.

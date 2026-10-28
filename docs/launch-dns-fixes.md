# Launch DNS integrity fixes

This document describes the additive launch fixes in migration `0009_launch_integrity.sql` and `server/business.ts`. It does not revise or delete any applied migration, table, trigger, legacy `names` row, or historical transfer.

## Proxy handover DNS claim

A proxy site with `proxy_sites.pending_name` now has an active matching `reserved_names` row of kind `proxy_pending` until its handover is accepted. On the accepted `handovers.status` update, the new `dns_names_claim_proxy_reservation_before_handover` trigger atomically:

1. deactivates that temporary proxy reservation;
2. inserts the authoritative `dns_names` row with the accepting account as owner and the proxy site as `site_id`;
3. records a `dns_name_events` event named `proxy_reservation_claimed`; and
4. clears `proxy_sites.pending_name`.

SQLite invokes multiple triggers for the same event in reverse creation order. Because `0009` is applied after `0008`, this new BEFORE trigger runs before `dns_names_before_proxy_handover`. The older trigger then sees `pending_name=NULL`; likewise the historical `proxy_handover_accepted` AFTER trigger does not attempt its restricted `names` insertion. This is essential for DNS-valid labels containing consecutive internal hyphens, such as `alpha--beta`.

The authoritative insert is deliberately **not** `OR IGNORE`: an unexpected collision rolls back the complete handover update. The older `names` table and any rows it contains are preserved unchanged. The event establishes a history record when a `--` label cannot exist in that historical table.

## Dashboard unbound names

`GET /api/dashboard` now includes:

```json
{
  "unboundNames": [
    { "name": "label" }
  ]
}
```

These are authoritative `dns_names` owned by the authenticated user whose `site_id` is `NULL`, typically after an approved name transfer. They are intentionally separate from `sites`; ownership of a label never implies ownership of the prior profile content, media, or site.

## Attach an owned unbound name

`POST /api/names/:name/attach` is an authenticated, fresh-session mutation. `:name` is canonicalized and validated as a DNS label.

### Request

Attach to an existing personal site:

```json
{ "siteId": "site-id" }
```

`siteId` must identify a site whose `sites.user_id` is the authenticated user. Manager access, proxy creator access, or a site belonging to a different account is not sufficient.

For a recipient with no personal site, omit `siteId` (or send `null`) to create a new first personal draft site and attach the owned label in one database batch:

```json
{}
```

Creation uses the same one-personal-site limit as normal name reservation. The insert is guarded by both `NOT EXISTS (sites.user_id=user)` and the still-owned, still-unbound label; a failed label check cannot create a stray site. If the user already has a personal site, `siteId` is required.

### Atomic guard and response

The update succeeds only where the label is still owned by the caller, is still unbound, and the target remains that caller's own site. No site ownership, site draft, publication, media, or content record is copied or changed.

A success response is:

```json
{
  "name": "label",
  "site": { "id": "site-id", "name": "label" },
  "createdSite": false,
  "attachedAt": 1730000000
}
```

`createdSite` is `true` only for the omitted-`siteId` first-site flow. Expected errors include `NAME_NOT_OWNED`, `NAME_ALREADY_ATTACHED`, `SITE_NOT_FOUND`, `SITE_FORBIDDEN`, `SITE_ID_REQUIRED`, and `NAME_ATTACH_CONFLICT`.

## Transfer and recipient correctness

`idx_transfers_one_active_name` is a partial unique index covering statuses `pending` and `accepted`. It is the concurrency authority behind `POST /api/names/transfer`; a unique conflict is returned as `409 TRANSFER_PENDING`. The migration purposefully does not alter historical rows. If the database already has duplicate active human transfers for a name, index creation fails visibly and must be resolved by an authorized operator before retrying migration application.

Recipient `C` identifiers are case-insensitive (`C2` and `c2` resolve to the same active account). Canonical response identifiers remain uppercase `C#`.

Wallet-transfer idempotency now resolves the submitted recipient before accepting a replay and compares both the amount and recipient account ID. Reusing a key with either a different amount or a differently resolved recipient returns `409 IDEMPOTENCY_CONFLICT`; it cannot report the prior movement as success for a different recipient or create a second ledger movement.

## Main-agent integration note

Use `dashboard.unboundNames` to show recipients their transferred labels and call the attach endpoint with the user's selected owned `siteId`. For a recipient without a site, the UI may offer the documented no-`siteId` creation flow. Do not infer that a transferred label grants access to the sender's site or content.

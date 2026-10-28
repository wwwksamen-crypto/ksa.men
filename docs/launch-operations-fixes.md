# Launch operations fixes — frontend/API handoff

This document covers the server changes in `server/operations.ts` and `server/preview.ts` only. No migration is required or proposed: immutable review decisions, publication triggers, compare-and-set (CAS) publication, and financial authorization rules remain unchanged.

## Review queue and decisions

### `GET /api/admin/reviews?status=pending&limit=50`

Each review now returns the submitted base and the **current** published-version context:

```json
{
  "base_version": 4,
  "baseVersion": 4,
  "current_published_version": 5,
  "currentPublishedVersion": 5,
  "is_stale": true,
  "isStale": true
}
```

`isStale` is true when `base_version !== current_published_version`. A stale review cannot be approved because the existing database CAS trigger rejects it.

The original published snapshot is not historically retained. Therefore, when `isStale` is true:

- `diff.before` is `null` and `diff.changes` / top-level `changes` are empty. Do not render the current live publication as the submission’s historical “before” value.
- `diff.currentPublished` (and snake-case `diff.current_published`) is the current live publication.
- `diff.currentChanges` (and snake-case `diff.current_changes`) compares that current live publication with the submitted snapshot. If shown, label it clearly as a **current live comparison**, not as the original submitted diff.

When `isStale` is false, the existing `diff.before`, `diff.after`, and `changes` contract remains valid.

A responsible manager’s queue and overview count now use the same site scope as protected preview and decision routes: the site is theirs, has `manager_id` set to them, or belongs to a user whose `assigned_to` is them. Owners remain global; moderators retain their established review access.

### `POST /api/admin/reviews/:id/decision`

A reviewer cannot decide a review they submitted. The endpoint returns:

```json
{
  "error": "You cannot decide a review you submitted; an independent owner, manager, or moderator must review it",
  "code": "reviewer_submitter_conflict"
}
```

with HTTP `403`. This applies to every role, including an owner reviewing their own proxy submission. An owner may still review a proxy or ordinary record submitted by someone else. The rejection enforces independent review; it does not alter the immutable snapshot, one-time decision record, or publication CAS.

## Protected review preview

`GET /api/admin/reviews/:id/preview` now accepts underscore characters in protected media IDs, matching `/api/media/:id` validation used by operations. For example, `/api/media/review_image_01` can render in the protected preview.

## Conversation detail

`GET /api/conversations/:id` now returns the same peer identity fields as `GET /api/messages` for an authenticated participant:

```json
{
  "conversation": {
    "id": "conversation-…",
    "other_id": 42,
    "other_name": "Peer display name"
  },
  "messages": []
}
```

Use `other_id` / `other_name` (or the dashboard’s normalized `other_user`) when opening a detail view so block/report controls retain the peer target. The route remains participant-only; it does not expose routine staff access to private conversations.

## Message picker emoji

Message text continues to allow ordinary text plus only the approved positive picker emoticons. The heart is normalized between `❤` and `❤️`, so the displayed picker heart is accepted. Emoji modifiers and ZWJ sequences are evaluated as complete sequences; arbitrary emoji are not admitted by this normalization.

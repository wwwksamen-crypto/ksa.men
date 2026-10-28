# Admin review UI launch note

## Scope

This change is limited to `client/src/Admin.tsx`, `client/src/admin.css`, and this note. It adds no route, permission, API mutation, deployment, or production-data action.

## Moderator review flow

- Review cards now show only decision-relevant provenance: member and name, submission time, the submitted base version, the current published version, and the server-returned stale state.
- The client reads `baseVersion`, `currentPublishedVersion`, and `isStale`, with snake-case compatibility for returned fields. A missing field remains **Unavailable**; the UI does not calculate or invent a version or stale value.
- The comparison is labelled as **current publication** versus the immutable **submitted snapshot**. It uses the server-returned comparison and snapshot rather than presenting the current publication as a historical base.
- When the server marks a review stale and withholds the before-side comparison, the UI states that a safe comparison is unavailable and directs the reviewer to the returned versions and protected snapshot preview; it never fabricates a before value.
- The preview action is explicitly a protected submitted-snapshot preview. It uses the returned `preview_url` or the existing authenticated review-preview route for the real review ID.
- Approve and reject controls render only while the review is pending. If the signed-in reviewer is also `review.user_id`, the card states that independent review is required and both decision buttons are disabled. The client guard is supplemental; server-side separation of duties remains authoritative.

## Verification

Run `pnpm typecheck` after integrating the companion review-response fields. No live API, browser, email, deployment, or Git operation is required for this UI-only change.

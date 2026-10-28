# Dashboard redesign handoff

## Delivered

The dashboard has been rebuilt as a compact premium workspace using the project’s shared token system. It keeps the existing dashboard data model, authenticated API calls, autosave behavior, review submission, wallet, subscriptions, messaging, security controls, translations, exports, and site-management operations unchanged.

### Workspace navigation

- Desktop uses a 232px sticky sidebar for the six top-level areas: editor, wallet, services, messages, subscription, and settings.
- Tablet and mobile replace the horizontal scroller with a meaningful two- or three-column navigation grid.
- The opening surface is intentionally concise: workspace identity, current site action, and current save state rather than a large welcome panel.

### Identity editor

- The original 18 editor steps are preserved but arranged into five comprehensible groups:
  1. Identity — identity, bio, contact
  2. Journey — experience, education, training, timeline
  3. Expertise — skills, memberships, languages, hobbies, achievements
  4. Showcase — evidence images, work samples, video, links, custom buttons
  5. Control — privacy and discovery
- Desktop provides a grouped sidebar; smaller screens retain those groups and their substeps in a responsive grid.
- Name and professional title are now the first inputs in the identity step. Photo and cover uploads remain available immediately after the required identity data.
- Save and preview controls live in a compact editor action bar. Review submission remains available through the preview dialog and creates the existing server-side review snapshot.

### Accessibility and guide context

- Draft preview now uses a native `<dialog>`, opens in the browser’s modal top layer, focuses its close control, handles Escape, and closes on backdrop click.
- The dashboard’s interactive workspace receives `inert` while the preview is open, so underlying controls cannot be focused or used.
- The dashboard dispatches `ksa:sanad-context` on context changes. The event only publishes UI metadata: active section, active editor step, save state, review status, and genuinely required missing labels. `requiredMissing` only contains the generic labels for **Name** and **Professional title** when either is blank; it never shares entered profile values, names, email, biography, or other user data.
- Dashboard CSS respects reduced-motion preferences and uses 44px minimum action targets and 48px form fields.

## Preserved integration points

The redesign continues to use all existing interfaces inside `Dashboard.tsx`:

- `/api/dashboard`, `/api/sites/:id`, `/api/sites/:id/draft`, and `/api/sites/:id/submit`
- image compression/upload and all draft fields
- wallet transfers, entitlement redemption, referral copying, and ledger rendering
- services, server-side identity quality, presence metrics, translation, exports, and quick links
- contact requests, conversations, blocks, reports, retention information, and notifications
- payment instructions/submission, site lock, trusted-device PIN, name transfer, handover, and deletion-request controls

No server, database, authentication, global stylesheet, asset, or parent-owned file was changed.

## Parent integration notes

- `Dashboard.tsx` continues importing `./dashboard.css`; no entrypoint change is needed.
- The CSS expects the contract tokens `--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border`, `--accent`, `--green`, `--danger`, and optionally `--gold`. If `--gold` is not yet set globally, dashboard gold accents safely fall back to `--accent`.
- The shared Sanad implementation can consume the dispatched `ksa:sanad-context` detail directly; the dashboard does not require any direct import of Sanad.

## Remaining considerations

- Full visual interaction should be checked when the parent’s current Sanad dock and final global tokens are present. The native dialog is intentionally in the browser top layer and should sit above the dock.
- Existing dashboard JSX helper functions remain functionally intact; their compact single-line formatting predates this redesign. New workspace and modal code is formatted for maintainability.

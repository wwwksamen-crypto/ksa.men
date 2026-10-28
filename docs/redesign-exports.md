# Exports redesign — 28 October 2026

## Scope completed

`client/src/Exports.tsx` and `client/src/exports.css` now present exports as a compact KSA.MEN output studio. The page uses the application visual tokens through component-local aliases, with emerald as the working action color and restrained gold for hierarchy, verification, and card-edge details. All visual selectors are scoped to `.exports-shell`, `.qr-tools`, or the export artwork classes.

The header has a clearer private-output hierarchy, concise language/refresh controls, and a responsive output-type selector. On small screens, the seven output choices become a two-column grid rather than a horizontally scrolling section bar. Controls retain at least 44px interaction height; QR form fields retain 48px height and 16px-capable inherited type.

## Output behavior preserved

- PDF generation remains text-based through the existing `pdfmake` implementation and embedded Tajawal fonts. The Arabic line/reordering helper and ATS-specific single-column document were not changed.
- QR remains high-resolution with H-level error correction and a scan-safe, owner-supplied centre mark.
- vCard serialization still filters hidden fields and escapes values as before.
- Card and social image downloads still render live HTML through `html-to-image` at their original 900×1200 and 1200×630 export dimensions.
- The badge print sheet remains available through `window.print()` and retains its print-only composition.
- No additional API calls, third-party assets, user fields, or data storage were added.

## New previews and data boundary

Digital, conference, social, and QR routes now show a compact in-page preview. The preview artwork is driven by the same public-field helpers used by the existing export path. Long names, role strings, destination URLs, and public links wrap safely; LTR URLs render inside `bdi` elements. Hidden profile fields remain excluded because the existing `field()` and card-detail logic are reused.

The capture artwork was moved into small reusable render components. This removes duplicate card markup while preserving the hidden, full-resolution capture targets used by `html-to-image`. The visible preview applies only parent-scoped proportional overrides and never changes capture dimensions.

## Shared guide integration

The page dispatches the documented `ksa:sanad-context` event without profile values:

- Export routes dispatch `section: 'editor'`, except the QR export route, which dispatches `section: 'qr'`.
- The standalone public QR tool dispatches `section: 'qr'`.
- Event detail contains only generic route, loading, and review state. It does not include names, emails, URLs, biography text, or form contents.

Parent integration: no import changes are required. The parent-owned Sanad implementation can consume these events once mounted in the application shell.

## Remaining validation

The component should be checked alongside the parent-owned application shell after merge, particularly with a real public profile containing long Arabic/English names, long custom-button URLs, a translated profile, and a narrow mobile viewport. This scoped change deliberately does not modify routing, authentication, server authorization, media CSP, PDF policy, or global tokens.

`pnpm typecheck` was run once after this change. It reported five existing diagnostics outside this scope: four unresolved `load` / `loading` names in `client/src/Admin.tsx` and one invalid `useEffect` cleanup return in `client/src/Dashboard.tsx`. It reported no diagnostics for `Exports.tsx`.

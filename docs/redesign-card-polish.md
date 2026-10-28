# Export card preview polish

## 28 October 2026 — proportional preview correction

The downloaded digital card remains a fixed **900 × 1200 CSS-pixel** artwork (captured at 2× for the 1800 × 2400 PNG). Its existing QR, privacy-filtered content, capture URL, QR payload, download action, and print flow are intentionally unchanged.

The in-page preview had inflated typography: several `cqw` values did not correspond to the fixed artwork's 900-pixel width. In particular, the name was rendered at `17.3cqw` rather than the proportional `7.33cqw`, forcing mixed Arabic/English identities into the QR and footer regions. The destination/location collision was a downstream effect of that oversized preview name and title.

`client/src/exports.css` now maps each preview type size to its matching fixed-art dimension. The result keeps the existing reserved QR square and footer space, while names, titles, geographic details, URLs, and social-card content wrap at the same visual proportion as their download captures. All preview text continues to use explicit sizing and `overflow-wrap` where URLs or mixed-direction content may be long.

No production route, authorization, PDF/ATS logic, data filtering, QR generation, assets, or capture dimensions changed.

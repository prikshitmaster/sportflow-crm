# brand/

Source brand assets. **Nothing here is imported by the app** — these are files
to upload through the UI, not bundled assets.

Committing a logo into `src/` would be wrong for a multi-tenant CRM: every
academy without a logo of its own would render ARA's crest as theirs. The app
reads `academies.logo_url` and falls back to a neutral `Trophy` icon, which is
the correct behaviour for a tenant that hasn't uploaded one.

## ara-logo.png

ARA FC crest — navy `#152449`, lime `#8FC63D`, transparent background,
367×304. This is the palette the "Academy App v2" design (and the `/join`
funnel that implements it) is built from.

Extracted from the Claude Design project `Academy App v2.dc.html`, then
background-flooded to transparent and trimmed to the crest.

`ara-logo-hires.png` is the same crest at 1202×937, supplied separately. It is
kept only as a higher-resolution source — it is a **cropped** capture (the
ribbon tails run off both sides and the shield's bottom tip is cut at the
edge), so `ara-logo.png` is the one to upload.

## Uploading it

Settings → Academy Profile → upload logo. That runs
`uploadAcademyLogo()` → `staff-photos/logos/{academyId}.png` →
`updateAcademyLogoUrl()` (`src/lib/db.js:1198-1210`), which sets
`academies.logo_url`.

The logo is academy-wide once set: it appears in the `/join` header and Academy
tab, and anywhere else the academy's mark is shown.

As of this commit `academies.logo_url` is NULL for slug `ara`, so `/join`
renders the `Trophy` fallback.

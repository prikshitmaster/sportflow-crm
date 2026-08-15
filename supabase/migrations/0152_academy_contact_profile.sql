-- ============================================================
-- 0152 — Academy contact profile
-- ============================================================
-- Settings → Academy Profile renders eight fields. Before this migration
-- exactly one of them (Academy Name) had anywhere to be stored: `academies`
-- was id / name / owner_id / join_code / created_at / logo_url / slug /
-- brand_color / app_display_name and nothing else.
--
-- Phone, address, city, state and GSTIN were hardcoded demo strings in
-- Settings.jsx ('Plot 14, Sector 7, Kharghar…', '27AADCC1234A1ZV'), and the
-- page's Save Changes handler only flipped a local flag and toasted "Settings
-- saved" — it never wrote anything. So the form showed invented data as if it
-- were the academy's own, and edits vanished on reload.
--
-- These are the columns those fields need. All nullable: every existing
-- academy predates them and none is required to operate.
--
-- Contact email is deliberately separate from the owner's auth email. The
-- login address is an auth credential and changing it needs a confirmation
-- flow; the academy's contact address is just what appears on receipts, and
-- the two are not always the same person.
--
-- No new RLS policy needed — academies_owner_update (0121) already scopes
-- UPDATE to owner_id = auth.uid(), which is exactly who edits this page.
-- ============================================================

alter table public.academies
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists address       text,
  add column if not exists city          text,
  add column if not exists state         text,
  add column if not exists gstin         text;

comment on column public.academies.contact_phone is 'Academy contact number shown on receipts. Not the owner''s personal profiles.phone.';
comment on column public.academies.contact_email is 'Academy contact email shown on receipts. Not the owner''s auth login email.';
comment on column public.academies.gstin         is 'Indian GST identification number, printed on fee receipts when set.';

-- Keep GSTIN honest rather than free-text: 15 chars, the standard
-- 2-digit state code + 10-char PAN + 3 trailing chars. Empty string is
-- normalised to NULL by the app, so the constraint only sees real values.
alter table public.academies
  drop constraint if exists academies_gstin_format;
alter table public.academies
  add constraint academies_gstin_format
  check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$');

notify pgrst, 'reload schema';

# SportFlow CRM — Database Schema

Run schemas in this order in Supabase SQL Editor:
1. `schema.sql` → `schema_v2.sql` → `schema_v3.sql` → `schema_v4.sql` → `schema_permissions.sql`

---

## Tables

### `students`
Core student record. One row per enrolled student.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `name` | text | |
| `parent` | text | parent/guardian name |
| `phone` | text | student phone |
| `parent_phone` | text | |
| `age` | integer | |
| `sport` | text | |
| `batch` | text | batch name (denormalized) |
| `batch_id` | bigint → batches.id | |
| `join_date` | date | |
| `status` | text | `Active` / `Inactive` / `Suspended` |
| `fees` | integer | current fee rate (INR) |
| `paid_till` | date | last month paid through |
| `student_code` | text UNIQUE | `SA001`, `SA002` … |
| `join_code` | text | one-time activation code (null after activation) |
| `password_hash` | text | SHA-256(SALT + password) |
| `account_status` | text | `pending` / `active` |
| `fee_amount` | integer | mirrors fees |
| `fee_due_day` | integer | day of month fee is due |
| `training_type` | text | `Daily` / `Alternate` |
| `fee_plan` | text | `monthly` / `quarterly` / `yearly` |
| `suspended_since` | date | set on suspend, null on reactivate |
| `last_batch_id` | bigint | reserved — not used yet |
| `last_batch_name` | text | reserved — not used yet |
| `academy_id` | uuid → academies.id | multi-tenant scope |

**Key invariant**: `batch` / `batch_id` are NOT cleared on suspend. Suspension only flips `status`. This lets coaches still see suspended students in their batch without any extra columns.

---

### `batches`
Training batches / groups.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `name` | text | |
| `code` | text | owner-defined short ID (e.g. `MOR-A`) |
| `time` | text | human-readable time string |
| `sports` | text[] | array of sport names |
| `coach` | text | assigned coach name |
| `capacity` | integer | max seats |
| `enrolled` | integer | current count (kept in sync by app) |
| `waitlist` | integer | |
| `days` | text[] | `['Mon','Wed','Fri']` etc. |
| `start_time` | text | `HH:MM` |
| `end_time` | text | `HH:MM` |
| `age_min` | integer | |
| `age_max` | integer | |
| `ground` | text | venue / ground name |
| `academy_id` | uuid | |

---

### `payments`
One row per payment invoice.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | invoice number, e.g. `INV-2026-001` |
| `student_id` | bigint → students.id | set null on student delete |
| `student` | text | denormalized name |
| `amount` | integer | INR |
| `month` | text | label e.g. `May 2026` or `May–Jul 2026` |
| `date` | date | payment date |
| `status` | text | `Paid` / `Pending` / `Overdue` |
| `mode` | text | `UPI` / `Cash` / `Bank Transfer` |
| `payment_type` | text | `monthly` / `quarterly` / `yearly` |
| `discount_pct` | integer | 0–100 |
| `months_covered` | integer | 1 / 3 / 12 |
| `academy_id` | uuid | |

---

### `attendance`
One row per student per day.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `date` | date | |
| `student_id` | bigint → students.id | CASCADE delete |
| `present` | boolean | |
| `status` | text | `Present` / `Absent` / `Late` / `Leave` |
| UNIQUE | `(date, student_id)` | upsert-safe |

---

### `trials`
Trial session leads.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `name` | text | |
| `parent` | text | |
| `phone` | text | |
| `sport` | text | |
| `trial_date` | date | |
| `source` | text | `Instagram` / `Referral` / `Walk-in` etc. |
| `status` | text | `Scheduled` / `Completed` / `Cancelled` |
| `converted` | boolean | true if became a paying student |
| `follow_up` | date | |
| `academy_id` | uuid | |

---

### `staff`
HR staff records (coaches, admins, etc.).

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `name` | text | |
| `role` | text | `Coach` / `Admin` / `Receptionist` etc. |
| `phone` | text | |
| `sports` | text[] | |
| `salary` | integer | |
| `join_date` | date | |
| `status` | text | `Active` / `Inactive` |
| `attendance` | integer | % (100 = perfect) |
| `photo_url` | text | Supabase Storage URL |
| `academy_id` | uuid | |

---

### `announcements`
Academy-wide notices.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `title` | text | |
| `body` | text | |
| `type` | text | `Announcement` / `Holiday` / `Tournament` etc. |
| `author` | text | |
| `date` | date | |
| `academy_id` | uuid | |

---

### `academies`
One row per sports academy (multi-tenant root).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | |
| `owner_id` | uuid | Supabase auth UID of owner |
| `join_code` | char(6) UNIQUE | staff use to link their account |

---

### `profiles`
One row per Supabase-auth user (owner or staff). Students use a different auth.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | = auth.users.id |
| `role` | text | `owner` / `staff` |
| `academy_id` | uuid → academies.id | |
| `name` | text | |
| `phone` | text | |

---

### `feature_flags`
Per-academy feature toggles.

| Column | Type | Notes |
|---|---|---|
| `academy_id` | uuid | |
| `feature` | text | |
| `enabled` | boolean | |
| PK | `(academy_id, feature)` | |

Supported features: `attendance`, `payments`, `trials`, `batches`, `staff`, `reports`, `community`, `events`, `gate_qr`.
Missing row → treated as enabled (default-on).

---

### `user_permissions`
Per-user access role + granular permissions for staff portal.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid → auth.users | UNIQUE |
| `academy_id` | uuid | |
| `name` | text | |
| `access_role` | text | `coach` / `receptionist` / `accountant` / `admin` / `staff` |
| `permissions` | text[] | list of permission keys |

---

### `staff_invites`
One-time invite links (7-day expiry) for adding staff portal users.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `token` | text UNIQUE | 48 hex chars |
| `academy_id` | uuid | |
| `name` | text | |
| `access_role` | text | |
| `permissions` | text[] | |
| `expires_at` | timestamptz | |
| `used` | boolean | flipped true on accept |

---

### `gate_qr`
Single QR token for physical gate attendance scanning.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `token` | text UNIQUE | 32 hex chars |
| `academy_name` | text | |

---

### `student_sessions`
Persistent student portal login tokens.

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `student_id` | bigint → students.id CASCADE | |
| `token` | text UNIQUE | 64 hex chars |
| `expires_at` | timestamptz | 30-day expiry |

---

### `leave_requests`
Staff leave requests reviewed by owner.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `staff_id` | uuid | profiles.id |
| `staff_name` | text | |
| `start_date` | date | |
| `end_date` | date | |
| `reason` | text | |
| `status` | text | `Pending` / `Approved` / `Rejected` |

---

### `staff_attendance`
Staff clock-in log via QR scan.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `academy_id` | uuid | |
| `profile_id` | uuid | profiles.id |
| `staff_name` | text | |
| `check_in_date` | date | |
| `check_in_time` | text | |
| UNIQUE | `(academy_id, profile_id, check_in_date)` | one scan per day |

---

### `academy_branches`
Owner-managed list of sports/branches shown on Dashboard filter.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `academy_id` | uuid | |
| `name` | text | |
| UNIQUE | `(academy_id, name)` | |

---

## Pending Schema Migrations (NOT YET RUN)
```sql
ALTER TABLE students ADD COLUMN IF NOT EXISTS training_type TEXT DEFAULT 'Daily';
ALTER TABLE students ADD COLUMN IF NOT EXISTS fee_plan TEXT DEFAULT 'monthly';
```
The app gracefully falls back (`|| 'Daily'`, `|| 'monthly'`) if columns are missing.

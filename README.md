# SportFlow CRM

A complete management system (SaaS) for Indian sports academies — students, fees,
attendance, staff, batches, trials, events, and reports. One codebase ships to
**four platforms**: Web (PWA), Android (Capacitor), Windows/Mac desktop (Electron),
and any mobile browser.

> **New here? Read in this order:**
> 1. This README (big picture + file map)
> 2. `docs/01_PROJECT_OVERVIEW.md` → `docs/07_DATA_FLOW.md` (numbered deep dives)
> 3. `docs/08_JUNE_2026_AUDIT.md` (the audit & timezone fix — what changed and why)
> 4. `docs/09_INTERVIEW_GUIDE.md` (explain every part of this project in an interview)

---

## 1. Tech stack (and *why* each piece)

| Layer | Tool | Why this one |
|---|---|---|
| UI | **React 18** | Component model; biggest ecosystem; easy to hire/learn |
| Build tool | **Vite 5** | Instant dev server, fast production builds (vs old Webpack) |
| Styling | **Tailwind CSS 3** | Utility classes — no separate CSS files to keep in sync |
| Routing | **React Router DOM 6** | Standard client-side routing for single-page apps |
| Backend | **Supabase** (hosted Postgres) | Database + Auth + REST API auto-generated. No server code to deploy |
| Charts | **Recharts** | Declarative React charts for the dashboard/reports |
| Icons | **Lucide React** | Tree-shakeable icon set (only icons you import get bundled) |
| Excel | **exceljs** + **xlsx-js-style** | Styled .xlsx exports (attendance/payments reports) |
| QR scan | **jsQR** + native `BarcodeDetector` | Camera-based QR scanning for attendance |
| QR show | **qrcode.react** | Renders the rotating gate/staff QR codes |
| Validation | **Zod** | Schema validation for forms/imports |
| Errors | **Sentry** | Production error tracking |
| Desktop | **Electron** | Wraps the built web app in a Windows/Mac desktop app |
| Android | **Capacitor 8** | Wraps the web app in a real APK; in production it loads the Vercel URL so users get updates without reinstalling |
| Offline | **vite-plugin-pwa / Workbox** | Service worker: installable app, offline shell, instant updates |

**There is no custom backend server.** The browser talks directly to Supabase.
Security lives in the database itself (Row Level Security + SECURITY DEFINER
functions) — see section 5.

---

## 2. Running the project

```bash
npm install          # install dependencies
npm run dev          # dev server → http://localhost:5173
npm run build        # production build → dist/
npm run preview      # serve the production build locally

npm run electron:dev     # desktop app in dev mode (Vite + Electron together)
npm run electron:build   # build Windows installer → dist-electron/
```

Secrets live in `.env` (gitignored — never commit it). `.env.example` shows the
required keys: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GROQ_KEY` (AI tips).

Database work uses the Supabase CLI (already linked to project `clubcrm`):

```bash
supabase db query --linked "SELECT ..."                       # run SQL on production
supabase db query --linked --file supabase/migrations/00XX_x.sql   # apply a migration
```

---

## 3. The four portals (who logs in and what they see)

| Portal | Who | Login method | Routes start with |
|---|---|---|---|
| **Owner** | Academy owner/admin | Email + password (Supabase Auth JWT) | `/` (Dashboard, Students, Payments…) |
| **Staff** | Coaches, office staff, branch managers | Email + password (custom token system) | `/staff/*` |
| **Student** | Players | Student code + password (custom token system) | `/student/*` |
| **Parent** | Parents (currently hidden/dormant) | Phone OTP (Supabase Auth) | `/parent/*` |

Each portal has its own layout component (sidebar/bottom-nav) and its own route
guard in `App.jsx` so a student can never open an owner page.

---

## 4. File structure (what every file does)

```
club crm/
│
├── index.html                  # The single HTML page. React mounts into <div id="root">
├── package.json                # Dependencies + npm scripts
├── vite.config.js              # Build config: PWA manifest, vendor chunk splitting
├── tailwind.config.js          # Tailwind theme (brand colors etc.)
├── vercel.json                 # Vercel hosting: SPA rewrite + caching + security headers
├── capacitor.config.ts         # Android wrapper config (points at Vercel URL in prod)
├── electron-builder.yml        # Desktop installer config (NSIS/DMG)
├── playwright.config.ts        # E2E test runner config (tests/ folder not present yet)
│
├── electron/
│   └── main.cjs                # Electron entry: creates the window, serves dist/ via a
│                               #   custom app:// protocol with an explicit MIME map
│                               #   (Windows registry MIME bug workaround)
│
├── supabase/migrations/        # EVERY database change ever made, in order (0001–0097).
│                               #   This is the database's git history. Never edit old
│                               #   ones — always add a new numbered file.
│
├── docs/                       # Deep-dive documentation (numbered reading order)
│
└── src/
    ├── main.jsx                # React entry point: renders <App/>, registers Sentry + SW
    ├── App.jsx                 # ALL routes + the four role guards (OwnerRoute etc.)
    ├── index.css               # Tailwind imports + shared classes (btn-primary, card…)
    ├── sw.js                   # Service worker source (offline cache, update flow)
    │
    ├── context/
    │   └── AppContext.jsx      # ❤️ THE HEART. Global state via React Context:
    │                           #   - holds user, students, payments, attendance, staff…
    │                           #   - all auth flows (login/logout/restore for 4 roles)
    │                           #   - branch + sport filtering (useMemo chains)
    │                           #   - every page reads/writes through useApp()
    │
    ├── lib/                    # Pure logic, no UI. Each file = one job.
    │   ├── supabase.js         # Creates the one shared Supabase client
    │   ├── db.js               # ~80 functions wrapping every DB read/write (the "API layer")
    │   ├── auth.js             # SHA-256 hashing, session token helpers
    │   ├── dates.js            # ⚠️ Local-date helpers (todayStr etc). NEVER use
    │   │                       #   toISOString() for calendar dates — see docs/08
    │   ├── permissions.js      # Permission keys + role presets (coach vs office vs manager)
    │   ├── studentRules.js     # Money rules: who is overdue, days overdue, ageing buckets
    │   ├── performance.js      # Skill assessment scoring, categories, tiers, month keys
    │   ├── audit.js            # Audit-log helpers (who did what, diffs)
    │   ├── schemas.js          # Zod validation schemas
    │   ├── whatsapp.js         # wa.me reminder links + per-day dedupe
    │   ├── exportImport.js     # Excel/JSON backup export + import parsing
    │   ├── sessionPDF.js       # Training-session PDF generation
    │   ├── sportCatalog.js     # List of supported sports + icons
    │   ├── notifications.js    # In-app notification helpers
    │   ├── loginThrottle.js    # Brute-force protection on login forms
    │   ├── imageUtils.js       # Image compression for uploads
    │   ├── logger.js           # Dev logging wrapper
    │   ├── sentry.js           # Sentry init (error tracking)
    │   └── devFill.js          # Demo-data generators (dev only)
    │
    ├── components/             # Reusable UI pieces shared across pages
    │   ├── Layout.jsx          # Owner shell: sidebar + header + <Outlet/> for the page
    │   ├── StaffLayout.jsx     # Staff shell (tabs depend on staff role)
    │   ├── StudentLayout.jsx   # Student shell (mobile bottom-nav style)
    │   ├── ParentLayout.jsx    # Parent shell
    │   ├── Sidebar.jsx / Header.jsx / BottomNav.jsx
    │   ├── Paginator.jsx       # Page navigation for long tables
    │   ├── Skeleton.jsx        # Loading placeholders
    │   ├── StudentAvatar.jsx   # Initials/photo avatar
    │   ├── SportIcon.jsx       # Icon per sport
    │   ├── NotificationBell.jsx
    │   ├── SendPayLinkModal.jsx / SendStaffNoticeModal.jsx / WhatsAppBulkModal.jsx
    │   └── DevFillButton.jsx   # Dev helper to fill forms with sample data
    │
    └── pages/                  # One file per screen
        ├── (owner pages at top level)
        │   Dashboard, Students, Payments, Attendance, Staff, Batches, Trials,
        │   Reports, Events, Community, Sessions, Drills, Settings, Backups,
        │   Parents, Inventory, TurfBooking, OpsActivity, SportSelect,
        │   AdminQR (student gate QR), StaffAttendanceQR (staff clock-in QR)
        ├── (public pages)
        │   Landing, Login, Signup, StaffLogin, StudentLogin, ParentLogin,
        │   Activate, StaffActivate, Invite, PayPublic, AssessmentReport
        ├── staff/    StaffDashboard, StaffScanIn (clock-in by QR), StaffAttendance,
        │             StaffAssess (skill ratings), StaffRoster, StaffMe, StaffPulse,
        │             StaffNotices, StaffTrials, StaffProfile, SessionPlanner
        ├── student/  StudentDashboard, StudentScan (gate QR), StudentAttendance,
        │             StudentPayments, StudentStats, StudentProgress, StudentAnnouncements
        └── parent/   ParentDashboard, ParentPayments, ParentNotices, ParentMe
```

---

## 5. How data & security work (30-second version)

1. **Reads**: pages call `useApp()` → AppContext loaded everything once via
   `db.js` → Supabase REST. Rows are scoped by `academy_id` (multi-tenant).
   Branch & sport filtering happens client-side in AppContext `useMemo`s.
2. **Writes**: every write goes through a **Postgres function (RPC)** named
   `secure_*`. The function checks *who you are* (session token → `current_actor()`),
   *what you may do* (`_require_perm()`), and *which branch you may touch*
   (`_require_branch_scope()`) — then performs the write with elevated rights
   (`SECURITY DEFINER`). Direct table writes from the browser are locked by RLS.
3. **Auth**: Owner/Parent use Supabase Auth (JWT). Staff/Student use a custom
   system: password → SHA-256 → match → server issues a random token stored in
   `staff_sessions` / `student_sessions` and in `localStorage`; every RPC call
   sends that token as `p_token`.

Details with diagrams: `docs/03_AUTH_SYSTEM.md` and `docs/07_DATA_FLOW.md`.

---

## 6. Golden rules (learned the hard way)

1. **Dates**: never derive a calendar date with `toISOString()` — it returns the
   UTC day, which is *yesterday* in India until 05:30 IST. Use `src/lib/dates.js`
   (`todayStr()`, `toLocalDateStr(d)`, `toLocalMonthStr(d)`). The DB mirrors this
   with `ist_today()` (migration 0097). Full story: `docs/08_JUNE_2026_AUDIT.md`.
2. **ID types**: Owner id = UUID. Staff id = BIGINT. Student id = BIGINT.
   Passing the wrong one to an RPC fails silently. Check before you call.
3. **New DB columns**: PostgREST caches table schemas — prefer a NEW table over
   `ALTER TABLE ADD COLUMN`, or reload the schema cache after altering.
4. **Migrations**: never edit an applied migration. Add the next number.
5. **Branch isolation**: staff scoping must use `user.branchId`, never
   `selectedBranch` (that's the owner's UI picker).
6. **Electron**: never serve local files via `net.fetch` — Windows MIME registry
   breaks ES modules. `electron/main.cjs` has the readFileSync + MIME map fix.

---

## 7. Deployment

| Target | How |
|---|---|
| **Web (PWA)** | Push to GitHub → Vercel auto-deploys. `vercel.json` adds SPA rewrite, immutable asset caching, security headers |
| **Android** | `npx cap sync android` → build APK in Android Studio. In production the APK loads the Vercel URL, so web deploys update the app instantly |
| **Desktop** | `npm run electron:build` → installer in `dist-electron/` |
| **Database** | `supabase db query --linked --file supabase/migrations/00XX_*.sql` |

**Deploy order when a change touches both DB and client:** migration first, then client.

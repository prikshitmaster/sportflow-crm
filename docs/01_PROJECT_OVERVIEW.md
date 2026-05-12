# SportFlow CRM — Project Overview

## What is it?
A sports academy management system (SaaS) for managing students, payments, attendance, staff, batches, and events. Multi-tenant (one DB, academy-scoped rows). Three separate portals for three user roles.

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 5 |
| Styling | Tailwind CSS 3 |
| Routing | React Router DOM 6 |
| Icons | Lucide React |
| Charts | Recharts |
| QR codes | qrcode.react |
| Excel export | xlsx |
| Backend/DB | Supabase (Postgres + Auth) |
| Client | Supabase JS v2 |

## Dev Server
```
npm run dev  →  http://localhost:5173
```

## Repository
- GitHub: `https://github.com/prikshitmaster/sportflow-crm`
- Branch: `main`

## Supabase
- Project name: `clubcrm`
- Project ID: `vdvpwbhkdlbskewfgref`
- URL: `https://vdvpwbhkdlbskewfgref.supabase.co`
- Credentials: `.env` (gitignored)
- RLS: **OFF** on all tables (single-tenant filters done in JS by `academy_id`)

## Project Structure

```
club crm/
├── src/
│   ├── App.jsx                    # Routes + 3-role guards
│   ├── main.jsx                   # React entry point
│   ├── index.css                  # Global CSS + utility classes
│   ├── context/
│   │   └── AppContext.jsx         # Global state + all auth + all CRUD actions
│   ├── lib/
│   │   ├── supabase.js            # Supabase client init
│   │   ├── db.js                  # All DB CRUD (raw Supabase calls)
│   │   ├── auth.js                # Auth helpers (hash, tokens, codes)
│   │   └── permissions.js         # Permission constants + role presets
│   ├── components/
│   │   ├── Layout.jsx             # Owner layout wrapper (sidebar + outlet)
│   │   ├── StaffLayout.jsx        # Staff portal layout
│   │   ├── StudentLayout.jsx      # Student portal layout
│   │   ├── Sidebar.jsx            # Owner sidebar nav
│   │   ├── Header.jsx             # Top bar
│   │   └── BottomNav.jsx          # Mobile bottom nav (student portal)
│   ├── pages/                     # Owner pages
│   ├── pages/staff/               # Staff portal pages
│   └── pages/student/             # Student portal pages
├── supabase/
│   ├── schema.sql                 # v1 — base tables
│   ├── schema_v2.sql              # v2 — student auth columns, gate_qr, sessions
│   ├── schema_v3.sql              # v3 — academies, profiles, feature_flags
│   ├── schema_v4.sql              # v4 — suspension, payment plan types
│   ├── schema_permissions.sql     # permissions, invites, branches tables
│   ├── fresh_seed.sql             # Full reset + seed
│   ├── demo_data_v2.sql           # Demo data
│   └── reset_owner.sql            # Reset owner account
└── docs/                          # This documentation folder
```

## CSS Utility Classes (`src/index.css`)
```
btn-primary    btn-secondary    btn-danger
card           input            label
badge          badge-green      badge-red
badge-yellow   badge-blue       badge-gray   badge-purple
```

## Three Portals at a Glance

| Portal | Login URL | Who |
|---|---|---|
| Owner | `/login` | Academy owner — full access |
| Staff | `/staff-login` | Coaches, receptionists, etc. — permission-gated |
| Student | `/student-login` | Students — view own data only |

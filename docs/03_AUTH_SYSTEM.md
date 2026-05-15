# SportFlow CRM — Auth System (3 Roles)

## Overview

There are three completely separate auth flows. All three are wired in `AppContext.jsx`.

```
Role     │ Auth Method                      │ Session Storage
─────────┼──────────────────────────────────┼───────────────────────────
Owner    │ Supabase Auth (email + password)  │ Supabase session (cookie)
Staff    │ Supabase Auth (email + password)  │ Supabase session (cookie)
Student  │ Custom (student_code + password)  │ localStorage key 'sf_student'
```

---

## Owner Auth

### Sign Up (`signupOwner`)
1. `supabase.auth.signUp(email, password)` — creates Supabase user
2. `db.createAcademy(ownerId, academyName, joinCode)` — creates academy row
3. `db.createProfile(userId, 'owner', academyId, name)` — creates profile row
4. `db.initDefaultFlags(academyId)` — seeds all feature flags as enabled
5. Sets context: `role = 'owner'`

### Login (`loginOwner`)
1. `supabase.auth.signInWithPassword(email, password)`
2. Fetch profile → verify `profile.role === 'owner'`
3. Fetch academy + feature flags
4. Sets context: `role = 'owner'`

### Logout (`logoutOwner`)
1. `supabase.auth.signOut()`
2. Clears all state

### Session Restore (on app open)
1. `supabase.auth.getSession()` → if session exists, fetch profile + academy + flags
2. Sets `role = 'owner'`

---

## Staff Auth

### How Staff Get Access (Invite Flow)
1. Owner goes to Staff page → "Invite Staff" → chooses name, access role, permissions
2. `inviteStaff()` → `db.createInvite()` → generates 48-char token → row in `staff_invites`
3. Owner shares URL: `https://app.com/invite/<token>` (7-day expiry)
4. Staff opens link → `Invite.jsx` → fills email + password → `db.acceptInvite()`
5. `acceptInvite()` does:
   - `supabase.auth.signUp(email, password)`
   - `db.createProfile(userId, 'staff', academyId, name)`
   - `db.saveUserPermissions(userId, academyId, accessRole, permissions, name)`
   - Creates HR staff record in `staff` table
   - Marks invite `used = true`

### Login (`loginStaff`)
1. `supabase.auth.signInWithPassword(email, password)` via `/staff-login`
2. Fetch profile → verify `profile.role !== 'owner'`
3. Fetch academy + feature flags + user permissions
4. Sets context: `role = 'staff'`, `permissions = [...]`

### Permission Check
```js
// Owner always returns true
// Staff checks their permissions array
hasPermission('students.manage')  // → true/false
```

### Access Roles + Default Permissions
| Role | Default Permissions |
|---|---|
| `coach` | attendance.manage, students.view, batches.view |
| `receptionist` | students.view, students.manage, trials.manage |
| `accountant` | payments.view, payments.manage, reports.view |
| `admin` | ALL permissions |
| `staff` | attendance.manage, students.view |

---

## Student Auth

Students use a completely custom auth — no Supabase Auth involved.

### Activation Flow (first-time login)
1. Owner adds student → system generates `student_code` (e.g. `SA001`) + `join_code` (e.g. `AB3XY7`)
2. Owner gives student their code + join code (out-of-band)
3. Student goes to `/activate` → enters `student_code` + `join_code` + sets a password
4. `activateStudent()` → `db.activateStudentAccount()`:
   - Verifies `student_code` + `join_code` + `account_status = 'pending'`
   - Stores `password_hash = SHA-256('sportflow-2026' + password)`
   - Sets `account_status = 'active'`, clears `join_code`

### Login (`loginStudent`)
1. Student goes to `/student-login` → enters `student_code` + password
2. `hashPassword(password)` → SHA-256 with salt `'sportflow-2026'`
3. `db.loginStudentAccount(studentCode, hash)` → finds matching active student
4. Generates 64-char random token → `db.createStudentSession(studentId, token)`
5. Stores in `localStorage` key `'sf_student'`: `{ token, expiresAt, id, studentCode, name }`
6. Sets context: `role = 'student'`, `studentUser = <student row>`

### Session Restore
On app open, `restore()` in AppContext checks `localStorage['sf_student']`:
- If token not expired → `db.validateStudentSession(token)` → joins `student_sessions` + `students`
- Valid → sets `role = 'student'`
- Invalid or expired → clears localStorage, falls through to login

### Password Reset (by Owner)
1. Owner clicks "Reset Password" on student → `resetStudentPasswordAdmin(id)`
2. Generates new `join_code` → `db.resetStudentPassword(id, newJoinCode)`
3. Sets `password_hash = null`, `account_status = 'pending'`, `join_code = newJoinCode`
4. Owner shares new join code → student re-activates
5. **Audit logged**: `action = 'student.password_reset'`, actor = current owner/staff user

---

## Route Guards (`App.jsx`)

```
OwnerRoute   → only role='owner'; else → /login
StaffRoute   → only role='staff'; else → /staff-login
StudentRoute → only role='student'; else → /student-login
PublicRoute  → redirects logged-in users to their home page
```

Loading state while checking session → `<PageLoading />` spinner.

---

## Audit Logging for Auth Actions

The following auth-adjacent actions are instrumented with `logAudit()` from `src/lib/audit.js`:

| Action | When |
|---|---|
| `student.password_reset` | Owner resets a student's password |
| `student.suspend` | Manual suspend by owner/staff |
| `student.reactivate` | Manual reactivate by owner/staff |

All audit events are fire-and-forget — they never block or throw.

# SportFlow CRM — Data Flow & State Management

## Architecture: 3 Layers

```
UI Pages / Components
        ↕ useApp() hook
AppContext.jsx (global state + actions)
        ↕ import * as db
src/lib/db.js (raw Supabase calls)
        ↕ supabase client
Supabase Postgres
```

---

## AppContext State

All global state lives in `src/context/AppContext.jsx`. Consumed via `useApp()` hook.

### Auth State
```
role          'owner' | 'staff' | 'student' | null
user          { id, name, email, academy, academyId, joinCode, role, accessRole }
studentUser   student DB row (when role='student')
loading       true while session is being restored
features      { attendance: bool, payments: bool, … }
permissions   string[] of granted permission keys
```

### Data State
```
students        Student[]
payments        Payment[]
trials          Trial[]
batches         Batch[]
staff           Staff[]
attendanceData  { [dateString]: { [studentId]: status } }
announcements   Announcement[]
events          Event[]
branches        string[]   (academy sport/branch names)
leaveRequests   LeaveRequest[]
dataLoading     bool
toast           { message, type } | null
```

### Data Loading Order (`loadAll`)
Called whenever `role === 'owner' || 'staff'` after login.
Runs 7 parallel fetches:
```
Promise.all([
  fetchStudents, fetchPayments, fetchTrials,
  fetchBatches, fetchStaff, fetchAnnouncements, fetchEvents
])
```
Then:
1. Auto-suspend check (3-day grace, Active students with expired paidTill)
2. `fetchAttendanceForDate(today)` — pre-loads today's attendance

---

## db.js — Function Reference

### Students
| Function | Operation |
|---|---|
| `fetchStudents(academyId)` | SELECT * ORDER BY name |
| `createStudentAccount(s)` | INSERT (full account row) |
| `updateStudent(id, s)` | UPDATE all editable fields |
| `deleteStudent(id)` | DELETE payments → sessions → student |
| `suspendStudent(id)` | UPDATE status='Suspended', suspended_since=today |
| `reactivateStudent(id)` | UPDATE status='Active', suspended_since=null |
| `activateStudentWithBatch(id, batchId, batchName, paidTill, fees)` | UPDATE with batch re-assignment |
| `updateStudentStatus(id, status)` | UPDATE status only |
| `updateStudentPaidTill(id, paidTill, fees)` | UPDATE paid_till (+ fees if provided) |
| `fetchNextStudentCode()` | Finds max SA### and returns next |
| `createStudentAccount(s)` | Full insert with all columns |
| `activateStudentAccount(code, joinCode, hash)` | Verify + set password |
| `loginStudentAccount(code, hash)` | Verify credentials |
| `resetStudentPassword(id, newJoinCode)` | Reset to pending |

### Payments
| Function | Operation |
|---|---|
| `fetchPayments(academyId)` | SELECT * ORDER BY created_at DESC |
| `insertPayment(p, invoiceId)` | INSERT with all columns |
| `deletePayment(id)` | DELETE by id |
| `updatePaymentStatus(id, status, mode)` | UPDATE + set today's date |
| `updatePaymentAmount(id, amount, monthsCovered)` | UPDATE amount |
| `updatePaymentDate(id, date)` | UPDATE date only |
| `fetchNextInvoiceNum()` | Scan all IDs, return maxNum+1 |

### Batches
| Function | Operation |
|---|---|
| `fetchBatches(academyId)` | SELECT * ORDER BY id |
| `insertBatchV2(b)` | INSERT with all v2 columns |
| `updateBatch(batchId, b)` | UPDATE all editable fields |
| `updateBatchCoach(batchId, coachName)` | UPDATE coach only |
| `updateBatchEnrolled(batchId, delta)` | Read → +delta → UPDATE (safe, no negative) |

### Attendance
| Function | Operation |
|---|---|
| `fetchAttendanceForDate(date)` | SELECT for one day → `{ [studentId]: status }` |
| `saveAttendanceForDate(date, records)` | UPSERT all records for one day |
| `fetchAttendanceForMonth(year, month)` | SELECT date range → `{ [studentId]: { [day]: status } }` |
| `saveAttendanceMonth(year, month, monthData)` | UPSERT entire month |
| `markAttendanceDirect(studentId)` | Mark today Present (no gate check) |
| `markAttendanceViaQR(studentId, gateToken)` | Validate gate token → mark today |
| `fetchStudentOwnAttendance(studentId, year, month)` | Student portal: own attendance |

### Sessions / Auth
| Function | Operation |
|---|---|
| `createStudentSession(studentId, token)` | INSERT session (30-day expiry) |
| `validateStudentSession(token)` | JOIN sessions + students, check expiry |
| `deleteStudentSession(token)` | DELETE session |
| `fetchProfile(userId)` | SELECT profile by auth UID |
| `createProfile(userId, role, academyId, name)` | INSERT profile |

### Staff Invites
| Function | Operation |
|---|---|
| `createInvite(academyId, name, accessRole, permissions)` | INSERT invite with 7-day expiry |
| `fetchInviteByToken(token)` | Verify not-used + not-expired |
| `acceptInvite(token, email, password)` | Full signup + profile + permissions + staff row |
| `fetchPendingInvites(academyId)` | Active unexpired invites |
| `deleteInvite(id)` | DELETE invite |

### User Permissions
| Function | Operation |
|---|---|
| `fetchUserPermissions(userId)` | SELECT access_role + permissions |
| `saveUserPermissions(userId, academyId, accessRole, permissions, name)` | UPSERT |
| `fetchAccessUsers(academyId)` | All users with portal access |
| `updateAccessUser(userId, accessRole, permissions)` | UPDATE |
| `revokeAccessUser(userId)` | DELETE |

---

## Context Actions Exposed via `useApp()`

### Auth
```
signupOwner, loginOwner, logoutOwner, logoutAdmin
loginStaff, logoutStaff
loginStudent, logoutStudent, activateStudent
```

### Students
```
addStudent(s)                    → creates + auto-payment + auto-suspend check
updateStudent(id, s)             → update + payment sync
deleteStudent(student)           → cascades payments + sessions
suspendStudent(student)          → manual suspend
reactivateStudent(student)       → manual reactivate (keeps batch)
updateStudentStatus(id, status)  → raw status change
resetStudentPasswordAdmin(id)    → generates new join code
refreshStudents()                → re-fetches from DB
```

### Payments
```
addPayment(p)             → record + auto-reactivate if suspended
markPaymentPaid(id, mode) → update status
removePayment(payment)    → delete + recompute paidTill
updatePaymentDate(id, date) → inline date edit
```

### Attendance
```
loadAttendanceForDate(date)      → lazy-loads, caches in attendanceData
saveAttendance(date, records)    → full day save
```

### Batches
```
addBatch(b)
updateBatch(batchId, b)
updateBatchCoach(batchId, coachName)
```

### Events
```
addEvent(e)
updateEventStatus(id, status)
removeEvent(id)
```

### Staff
```
addStaffMember(s)
inviteStaff(name, accessRole, permissions) → returns invite URL
updateStaffAccess(userId, accessRole, permissions)
revokeStaffAccess(userId)
```

### Branches / Announcements / Leave
```
addBranch(name) / removeBranch(name)
addAnnouncement(a)
submitLeave(startDate, endDate, reason)
loadLeaveRequests()
updateLeave(id, status)
```

### Features
```
toggleFeature(feature, enabled)   → DB upsert + local state
isFeatureOn(name)                 → bool
hasPermission(perm)               → owner=true; staff=checks array
```

---

## Toast Notifications

`showToast(message, type)` — pops a toast for 3.5 seconds.
- `type`: `'success'` (green) | `'error'` (red) | `'info'` (blue)
- Rendered by `<Toast>` component inside AppProvider

---

## Key Design Patterns

### Optimistic Local State
All write operations update local state immediately after DB write succeeds. No re-fetch needed. `refreshStudents()` is available as escape hatch.

### Academy Scoping
All DB queries filter by `academy_id` from `user.academyId`. Staff see the same academy as the owner who invited them.

### Batch Enrolled Counter
`enrolled` on `batches` is an integer kept in sync manually:
- Student added to batch → `+1`
- Student removed from batch → `-1`
- Student suspended → `-1`
- Student reactivated / paid → `+1`
- Student deleted (not suspended) → `-1`

### calcHistoricalPayment
Used when a student is added/edited with a `paidTill` date. Computes what the auto-generated payment should look like without creating a duplicate if the payment already exists for the same month label.

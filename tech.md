# SportFlow CRM — Claude Prompt (React + Node + Vercel + Supabase)

Build a production-ready **mobile-first Sports Academy SaaS CRM**.

## Tech Stack

Frontend:

* React
* Vite or Next.js frontend preferred
* Tailwind CSS
* React Router
* Axios

Backend:

* Node.js
* Express.js API

Database / Auth / Storage:

* Supabase
* PostgreSQL
* Supabase Auth
* Supabase Storage

Deployment:

* Vercel (frontend)
* Backend deploy as Vercel serverless functions or separate Node API

## Product Goal

Help sports academies manage:

* students
* attendance
* fees
* trials
* batches
* staff
* announcements
* reports

## Build Architecture

### Frontend Structure

/src
/components
/pages
/layouts
/hooks
/services
/utils

### Backend Structure

/server
/routes
/controllers
/middleware
/services
/utils

## Core Pages

### Dashboard

Cards:

* total students
* today attendance
* pending fees
* monthly revenue
* new trials

### Students

Fields:

* student name
* parent name
* phone
* sport
* batch
* join date
* status

### Attendance

* one tap mark
* bulk mark
* date wise history
* monthly report

### Payments

* paid / pending / overdue
* invoice number auto generate
* payment history
* receipt
* monthly summary

### Trials

* lead capture
* trial date
* reminder status
* source
* joined / lost

### Batches

* name
* timing
* capacity
* coach
* active count

### Staff

* coaches
* salary tracker
* attendance

### Community

* notices
* holidays
* events

### Reports

* revenue graph
* attendance trend
* pending fees
* trial conversion

## Mobile Responsive Rules

* mobile first design
* bottom navbar mobile
* sidebar desktop
* sticky action button
* forms full width
* tap friendly buttons
* fast transitions

## Supabase Tables

users
academies
students
parents
attendance
payments
invoices
trials
batches
staff
announcements

## Auth

* owner login
* coach login
* role permissions

## Important India Features

* ₹ currency
* UPI payment link field
* WhatsApp click button
* dd/mm/yyyy format

## Performance Rules

* lazy load pages
* reusable components
* pagination tables
* debounce search
* optimize images
* compress uploads

## Deployment Rules

Frontend deploy to Vercel.
Backend deploy to Vercel API routes or separate Node host.
Use env vars for Supabase keys.

## UI Style

Premium clean SaaS.
Trustworthy for Indian businesses.
Simple, sharp, modern.

## Token Saving Rules

* concise code
* reusable components
* no oversized files
* split modules smartly
* avoid unnecessary explanation

## Priority Build Order

1. Auth
2. Dashboard
3. Students
4. Attendance
5. Payments
6. Trials
7. Reports 2
8. mobile responsive

## Final Goal

Make users willing to pay ₹1999/month because it saves time, improves fee collection, and removes chaos.
 
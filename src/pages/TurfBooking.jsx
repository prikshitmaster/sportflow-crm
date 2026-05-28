import {
  MapPin, Lock, CalendarRange, CreditCard, Users,
  Clock, BellRing, BarChart2, Shield, Sparkles,
  CheckCircle2, Repeat, QrCode,
} from 'lucide-react'

const FEATURES = [
  {
    icon: CalendarRange,
    title: 'Slot Management',
    desc: 'Define turf slots by duration, price, and availability. Block maintenance windows.',
  },
  {
    icon: CreditCard,
    title: 'Online Booking & Payment',
    desc: 'Members book and pay directly from the app. Razorpay integrated.',
  },
  {
    icon: Repeat,
    title: 'Recurring Bookings',
    desc: 'Weekly fixed slots for teams or coaches. Auto-renew with one approval.',
  },
  {
    icon: Users,
    title: 'Capacity Control',
    desc: 'Set max players per slot. Waitlist auto-promotes when someone cancels.',
  },
  {
    icon: QrCode,
    title: 'QR Gate Access',
    desc: 'Players scan QR at entry. Staff see who\'s booked for any slot in real time.',
  },
  {
    icon: BarChart2,
    title: 'Utilisation Reports',
    desc: 'Peak hours, revenue per turf, cancellation rates — exported to Excel.',
  },
  {
    icon: BellRing,
    title: 'Reminders & Notifications',
    desc: 'Auto-remind players 1 hour before. Send cancellation alerts instantly.',
  },
  {
    icon: Clock,
    title: 'Flexible Pricing',
    desc: 'Peak/off-peak rates, member discounts, bulk-hour packages.',
  },
]

function PreviewSlot({ time, team, status }) {
  const colors = {
    Booked:    'bg-emerald-100 text-emerald-700 border-emerald-200',
    Available: 'bg-gray-50 text-gray-400 border-gray-200',
    Blocked:   'bg-red-50 text-red-400 border-red-200',
  }
  return (
    <div className={`rounded-lg border px-3 py-2 ${colors[status]} opacity-60 blur-[0.5px]`}>
      <p className="text-[11px] font-black">{time}</p>
      <p className="text-[10px] mt-0.5">{team}</p>
    </div>
  )
}

function FeatureRow({ icon: Icon, title, desc }) {
  return (
    <div className="flex gap-4 p-4 rounded-xl bg-white border border-gray-100 hover:border-blue-200 transition-colors">
      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
        <Icon size={20} className="text-blue-600" />
      </div>
      <div>
        <p className="text-sm font-bold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
      <CheckCircle2 size={16} className="ml-auto text-blue-400 flex-shrink-0 mt-0.5" />
    </div>
  )
}

export default function TurfBooking() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">

      {/* Header */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 p-8 text-white shadow-xl">
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '32px 32px' }} />

        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg">
              <MapPin size={28} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-black">Turf Booking</h1>
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest bg-amber-500 text-white px-2.5 py-1 rounded-full shadow">
                  <Sparkles size={10} /> Premium
                </span>
              </div>
              <p className="text-blue-200 text-sm max-w-md">
                Full slot booking system for turfs, courts, and facilities — with payments,
                QR access, and utilisation reports. Coming in a future update.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-4 py-3 backdrop-blur-sm">
            <Lock size={18} className="text-amber-400" />
            <div>
              <p className="text-xs font-black text-white">Future Update</p>
              <p className="text-[11px] text-blue-300">Premium tier</p>
            </div>
          </div>
        </div>
      </div>

      {/* Blurred booking preview */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Lock size={11} /> Preview — unlocks with premium
        </p>
        <div className="relative bg-white rounded-2xl border border-gray-100 p-5 opacity-80">
          <div className="flex items-center justify-between mb-4 blur-[0.5px]">
            <div>
              <p className="text-sm font-black text-gray-800">Turf A — Thursday 29 May</p>
              <p className="text-xs text-gray-400">6 slots · 4 booked · 2 available</p>
            </div>
            <div className="flex gap-2">
              <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">Booked</span>
              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold">Available</span>
              <span className="text-[10px] bg-red-100 text-red-500 px-2 py-0.5 rounded-full font-bold">Blocked</span>
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <PreviewSlot time="06:00–07:00" team="Lions FC"      status="Booked" />
            <PreviewSlot time="07:00–08:00" team="U15 Morning"   status="Booked" />
            <PreviewSlot time="08:00–09:00" team="Available"     status="Available" />
            <PreviewSlot time="09:00–10:00" team="Available"     status="Available" />
            <PreviewSlot time="10:00–11:00" team="Maintenance"   status="Blocked" />
            <PreviewSlot time="11:00–12:00" team="Tigers CC"     status="Booked" />
          </div>

          {/* lock overlay */}
          <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
            <div className="bg-white/85 backdrop-blur-sm border border-gray-200 rounded-2xl px-5 py-3 flex items-center gap-2 shadow-lg">
              <Lock size={16} className="text-amber-500" />
              <span className="text-sm font-black text-gray-700">Locked — Premium Feature</span>
            </div>
          </div>
        </div>
      </div>

      {/* Features grid */}
      <div>
        <h2 className="text-base font-black text-gray-900 mb-3">What's included</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {FEATURES.map(f => <FeatureRow key={f.title} {...f} />)}
        </div>
      </div>

      {/* Coming soon callout */}
      <div className="rounded-2xl bg-blue-50 border border-blue-200 p-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
          <Shield size={24} className="text-blue-600" />
        </div>
        <div>
          <p className="font-black text-gray-900 text-base">Available in a future Premium update</p>
          <p className="text-sm text-gray-600 mt-1">
            Turf Booking is in development and will be available as part of the
            SportFlow Premium tier. Supports multiple turfs, courts, or any bookable facility.
          </p>
          <p className="text-xs text-blue-700 font-semibold mt-3 uppercase tracking-wide">
            Planned: Slot management · Online payments · QR access · Recurring bookings · Utilisation reports
          </p>
        </div>
      </div>

    </div>
  )
}

import {
  Package, Lock, Boxes, ArrowLeftRight, BellRing,
  Tag, ClipboardList, BarChart2, Shield, Sparkles,
  CheckCircle2,
} from 'lucide-react'

const FEATURES = [
  {
    icon: Boxes,
    title: 'Equipment Catalogue',
    desc: 'Track every item — balls, bibs, cones, rackets, kits — with photo, quantity, and condition.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Issue & Return Log',
    desc: 'Log equipment issued to students or staff. One-click return with condition note.',
  },
  {
    icon: BellRing,
    title: 'Low Stock Alerts',
    desc: 'Set minimum thresholds per item. Get notified before you run out.',
  },
  {
    icon: Tag,
    title: 'Categories & Tags',
    desc: 'Organise by sport, type, or custom category. Filter and search in seconds.',
  },
  {
    icon: ClipboardList,
    title: 'Audit Trail',
    desc: 'Full history of every movement — who took what, when, and current status.',
  },
  {
    icon: BarChart2,
    title: 'Usage Reports',
    desc: 'See which items are most used, what\'s overdue, and total inventory value.',
  },
]

function PreviewCard({ icon: Icon, title, value, color }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3 opacity-60 blur-[0.5px]`}>
      <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold">{title}</p>
        <p className="text-lg font-black text-gray-800">{value}</p>
      </div>
    </div>
  )
}

function FeatureRow({ icon: Icon, title, desc }) {
  return (
    <div className="flex gap-4 p-4 rounded-xl bg-white border border-gray-100 hover:border-amber-200 transition-colors">
      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
        <Icon size={20} className="text-amber-600" />
      </div>
      <div>
        <p className="text-sm font-bold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
      <CheckCircle2 size={16} className="ml-auto text-amber-400 flex-shrink-0 mt-0.5" />
    </div>
  )
}

export default function Inventory() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">

      {/* Header */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8 text-white shadow-xl">
        {/* subtle grid pattern */}
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '32px 32px' }} />

        <div className="relative flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center shadow-lg">
              <Package size={28} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-2xl font-black">Inventory</h1>
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest bg-amber-500 text-white px-2.5 py-1 rounded-full shadow">
                  <Sparkles size={10} /> Premium
                </span>
              </div>
              <p className="text-gray-300 text-sm max-w-md">
                Full equipment management — catalogues, issue logs, alerts, and reports.
                Coming in a future update.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-4 py-3 backdrop-blur-sm">
            <Lock size={18} className="text-amber-400" />
            <div>
              <p className="text-xs font-black text-white">Future Update</p>
              <p className="text-[11px] text-gray-400">Premium tier</p>
            </div>
          </div>
        </div>
      </div>

      {/* Blurred preview stats */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Lock size={11} /> Preview — unlocks with premium
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 relative">
          <PreviewCard icon={Boxes}        title="Total Items"    value="142"   color="bg-blue-500" />
          <PreviewCard icon={ArrowLeftRight} title="Issued"      value="23"    color="bg-amber-500" />
          <PreviewCard icon={BellRing}     title="Low Stock"     value="4"     color="bg-red-500" />
          <PreviewCard icon={CheckCircle2} title="Returned Today" value="7"   color="bg-emerald-500" />
          {/* lock overlay */}
          <div className="absolute inset-0 flex items-center justify-center rounded-xl">
            <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-2xl px-5 py-3 flex items-center gap-2 shadow-lg">
              <Lock size={16} className="text-amber-500" />
              <span className="text-sm font-black text-gray-700">Locked — Premium Feature</span>
            </div>
          </div>
        </div>
      </div>

      {/* What's included */}
      <div>
        <h2 className="text-base font-black text-gray-900 mb-3">What's included</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {FEATURES.map(f => <FeatureRow key={f.title} {...f} />)}
        </div>
      </div>

      {/* Coming soon callout */}
      <div className="rounded-2xl bg-amber-50 border border-amber-200 p-6 flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Shield size={24} className="text-amber-600" />
        </div>
        <div>
          <p className="font-black text-gray-900 text-base">Available in a future Premium update</p>
          <p className="text-sm text-gray-600 mt-1">
            Inventory Management is in development and will be available as part of the
            SportFlow Premium tier. Your existing data and features are unaffected.
          </p>
          <p className="text-xs text-amber-700 font-semibold mt-3 uppercase tracking-wide">
            Planned: Equipment catalogue · Issue & return tracking · Low stock alerts · Export reports
          </p>
        </div>
      </div>

    </div>
  )
}

import { Link } from 'react-router-dom'
import {
  Zap, Users, CalendarCheck, CreditCard, Bell, BarChart3, UserPlus,
  CheckCircle, ArrowRight, Star, Shield, Smartphone, TrendingUp,
  MessageSquare, Layers, Menu, X,
} from 'lucide-react'
import { useState } from 'react'

const features = [
  { icon: Users,        title: 'Student Management',     desc: 'Add students, track sports, assign batches and manage parent contacts — all in one place.' },
  { icon: CalendarCheck,title: 'Smart Attendance',       desc: 'One-click attendance, bulk marking, QR check-in ready. Know who showed up before the session starts.' },
  { icon: CreditCard,   title: 'Fee & Payment Tracker',  desc: 'Track paid, pending and overdue fees. Auto-generate invoices. Send WhatsApp reminders with one click.' },
  { icon: UserPlus,     title: 'Trial Lead Pipeline',    desc: 'Capture trial students from Instagram, walk-ins, or referrals. Follow up until they convert.' },
  { icon: Bell,         title: 'Automated Reminders',    desc: 'Fee dues, trial follow-ups, and absent alerts sent automatically via WhatsApp and SMS.' },
  { icon: BarChart3,    title: 'Revenue & Reports',      desc: 'Monthly revenue charts, attendance trends, and pending collection reports — all at a glance.' },
]

const steps = [
  { step: '01', title: 'Add your students and batches', desc: 'Set up your academy in minutes. Import existing students or add them one by one.' },
  { step: '02', title: 'Track daily with one click',    desc: 'Mark attendance, collect fees, manage trials — all from your phone or laptop.' },
  { step: '03', title: 'Grow with clear data',          desc: 'See revenue, conversion rates, and attendance trends. Make decisions based on facts, not guesses.' },
]

const testimonials = [
  { name: 'Rajesh Patel', academy: 'Patel Football Academy, Ahmedabad', avatar: 'RP', quote: 'Before SportFlow, I was managing 120 students on WhatsApp groups and Excel sheets. Now I know exactly who paid, who didn\'t, and who needs a follow-up. Game changer.' },
  { name: 'Priya Krishnan', academy: 'Step Up Dance Studio, Bangalore', avatar: 'PK', quote: 'The fee reminder feature alone has reduced my pending collections by 60%. Parents take it seriously when the invoice looks professional.' },
  { name: 'Amit Verma', academy: 'Striker Cricket Academy, Delhi', avatar: 'AV', quote: 'I was skeptical, but the trial management pipeline helped us convert 8 out of 10 trials last month. That\'s ₹20,000 extra per month.' },
]

const plans = [
  { name: 'Starter',    price: '₹999',  period: '/month', students: 'Up to 50 students',   features: ['Student & attendance',  'Payment tracking',      'Basic reports',          '1 coach account',        'Email support'], popular: false },
  { name: 'Pro',        price: '₹1,999',period: '/month', students: 'Up to 200 students',  features: ['Everything in Starter', 'WhatsApp reminders',    'Trial pipeline',         '5 staff accounts',       'Priority support', 'Revenue analytics'], popular: true },
  { name: 'Enterprise', price: 'Custom', period: '',       students: 'Unlimited students',  features: ['Everything in Pro',     'Multi-branch support',  'Custom integrations',    'Unlimited accounts',     'Dedicated account manager'], popular: false },
]

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">SportFlow</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-gray-600 hover:text-gray-900 transition">Features</a>
            <a href="#how" className="text-sm text-gray-600 hover:text-gray-900 transition">How it Works</a>
            <a href="#pricing" className="text-sm text-gray-600 hover:text-gray-900 transition">Pricing</a>
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900 transition">Login</Link>
            <Link to="/login" className="btn-primary text-xs px-4 py-2">Start Free Trial</Link>
          </div>
          <button className="md:hidden p-2" onClick={() => setMenuOpen(o => !o)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-3">
            <a href="#features" className="block text-sm text-gray-700">Features</a>
            <a href="#how" className="block text-sm text-gray-700">How it Works</a>
            <a href="#pricing" className="block text-sm text-gray-700">Pricing</a>
            <Link to="/login" className="block text-sm text-gray-700">Login</Link>
            <Link to="/login" className="btn-primary w-full justify-center">Start Free Trial</Link>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-900 to-brand-900 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22none%22 fill-rule=%22evenodd%22%3E%3Cg fill=%22%23ffffff%22 fill-opacity=%220.03%22%3E%3Cpath d=%22M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-24 md:py-36">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 bg-brand-600/20 border border-brand-500/30 rounded-full px-4 py-1.5 mb-8">
              <span className="w-2 h-2 bg-brand-400 rounded-full animate-pulse"></span>
              <span className="text-xs font-medium text-brand-300">Trusted by 500+ Sports Academies across India</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-black leading-tight mb-6">
              Stop Running Your<br />
              <span className="text-brand-400">Academy on WhatsApp</span><br />
              and Excel
            </h1>
            <p className="text-lg md:text-xl text-gray-300 mb-10 max-w-2xl leading-relaxed">
              Manage attendance, fees, trial students, reminders and growth in one smart system. Built for Indian sports academies.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link to="/login" className="inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-bold text-base px-8 py-4 rounded-xl transition-all shadow-lg shadow-brand-600/30 active:scale-95">
                Start Free Trial — 14 Days Free
                <ArrowRight size={18} />
              </Link>
              <a href="#how" className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold text-base px-8 py-4 rounded-xl border border-white/20 transition">
                See How It Works
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-6 mt-10 text-sm text-gray-400">
              {['No credit card required', 'Cancel anytime', 'Setup in 10 minutes', '₹1,999/month after trial'].map(t => (
                <div key={t} className="flex items-center gap-1.5">
                  <CheckCircle size={14} className="text-brand-400" />
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Dashboard preview mockup */}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pb-0 -mb-1">
          <div className="bg-gray-800 rounded-t-2xl border border-gray-700 border-b-0 p-4 shadow-2xl">
            <div className="flex items-center gap-1.5 mb-4">
              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Students', value: '142', color: 'bg-brand-600' },
                { label: "Today's Attendance", value: '118 / 142', color: 'bg-emerald-600' },
                { label: 'Pending Fees', value: '₹38,200', color: 'bg-amber-600' },
                { label: 'Monthly Revenue', value: '₹2,18,500', color: 'bg-purple-600' },
              ].map(c => (
                <div key={c.label} className="bg-gray-900 rounded-xl p-3">
                  <div className={`w-7 h-7 ${c.color} rounded-lg mb-2`}></div>
                  <p className="text-white font-bold text-base">{c.value}</p>
                  <p className="text-gray-400 text-xs">{c.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Social proof bar */}
      <div className="bg-gray-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-center gap-8">
          {[
            { label: 'Academies', value: '500+' },
            { label: 'Students Managed', value: '45,000+' },
            { label: 'Fees Collected', value: '₹12 Cr+' },
            { label: 'States Covered', value: '18' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className="text-xl font-black text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <section id="features" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-brand-600 uppercase tracking-widest mb-3">Everything You Need</p>
            <h2 className="text-3xl md:text-4xl font-black text-gray-900 mb-4">
              Replace 6 different tools<br />with one smart system
            </h2>
            <p className="text-gray-500 max-w-xl mx-auto text-base">No more juggling between WhatsApp, Excel, Paytm notes, and Google Sheets.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(f => (
              <div key={f.title} className="border border-gray-100 rounded-2xl p-6 hover:border-brand-200 hover:shadow-md transition-all group">
                <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-brand-100 transition">
                  <f.icon size={22} className="text-brand-600" />
                </div>
                <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-brand-600 uppercase tracking-widest mb-3">Simple Setup</p>
            <h2 className="text-3xl md:text-4xl font-black text-gray-900">Up and running in 10 minutes</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((s, i) => (
              <div key={s.step} className="relative">
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-6 left-full w-full h-px bg-gray-200 -translate-y-px z-0"></div>
                )}
                <div className="relative bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                  <div className="text-4xl font-black text-gray-100 mb-3">{s.step}</div>
                  <h3 className="font-bold text-gray-900 mb-2">{s.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-brand-600 uppercase tracking-widest mb-3">Real Results</p>
            <h2 className="text-3xl md:text-4xl font-black text-gray-900">Academy owners love SportFlow</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map(t => (
              <div key={t.name} className="border border-gray-100 rounded-2xl p-6 bg-white shadow-sm hover:shadow-md transition">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, i) => <Star key={i} size={14} className="text-amber-400 fill-amber-400" />)}
                </div>
                <p className="text-gray-700 text-sm leading-relaxed mb-6">"{t.quote}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                    {t.avatar}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-400">{t.academy}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold text-brand-600 uppercase tracking-widest mb-3">Simple Pricing</p>
            <h2 className="text-3xl md:text-4xl font-black text-gray-900">Start free. Grow with us.</h2>
            <p className="text-gray-500 mt-3">No hidden fees. No setup cost. Cancel anytime.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map(p => (
              <div key={p.name} className={`rounded-2xl p-6 border-2 relative ${p.popular ? 'bg-brand-600 border-brand-600 text-white shadow-xl shadow-brand-600/20' : 'bg-white border-gray-100'}`}>
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-gray-900 text-xs font-bold px-3 py-1 rounded-full">Most Popular</div>
                )}
                <h3 className={`font-bold text-lg mb-1 ${p.popular ? 'text-white' : 'text-gray-900'}`}>{p.name}</h3>
                <p className={`text-xs mb-4 ${p.popular ? 'text-brand-200' : 'text-gray-500'}`}>{p.students}</p>
                <div className="flex items-end gap-1 mb-6">
                  <span className={`text-4xl font-black ${p.popular ? 'text-white' : 'text-gray-900'}`}>{p.price}</span>
                  <span className={`text-sm mb-1 ${p.popular ? 'text-brand-200' : 'text-gray-400'}`}>{p.period}</span>
                </div>
                <ul className="space-y-2.5 mb-8">
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-2.5">
                      <CheckCircle size={14} className={p.popular ? 'text-brand-200' : 'text-brand-600'} />
                      <span className={`text-sm ${p.popular ? 'text-brand-100' : 'text-gray-600'}`}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/login"
                  className={`block text-center py-3 px-4 rounded-xl font-bold text-sm transition active:scale-95 ${
                    p.popular
                      ? 'bg-white text-brand-600 hover:bg-brand-50'
                      : 'bg-brand-600 text-white hover:bg-brand-700'
                  }`}
                >
                  {p.name === 'Enterprise' ? 'Contact Sales' : 'Get Started'}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Banner */}
      <section className="py-20 bg-gray-900 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-black mb-4">
            Your academy deserves better than<br /><span className="text-brand-400">WhatsApp + Excel</span>
          </h2>
          <p className="text-gray-400 mb-8">Join 500+ academies already running smarter with SportFlow CRM.</p>
          <Link to="/login" className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-bold text-lg px-10 py-4 rounded-xl transition shadow-lg shadow-brand-600/30 active:scale-95">
            Start Your Free Trial Today
            <ArrowRight size={20} />
          </Link>
          <p className="text-xs text-gray-500 mt-4">14 days free · No credit card · Cancel anytime</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 border-t border-gray-800 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
              <Zap size={14} className="text-white" />
            </div>
            <span className="text-white font-bold">SportFlow CRM</span>
          </div>
          <p className="text-sm text-gray-500">© 2026 SportFlow. Made with ❤️ for Indian sports academies.</p>
          <div className="flex gap-6 text-sm text-gray-500">
            <a href="#" className="hover:text-white transition">Privacy</a>
            <a href="#" className="hover:text-white transition">Terms</a>
            <a href="#" className="hover:text-white transition">Support</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

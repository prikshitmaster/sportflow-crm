// Bold two-tone ring loading indicator — replaces the thin pie-wedge SVG
// that was duplicated inline across the app. Inherits size/color the same
// way the inline version did: pass Tailwind size + text-color classes
// (e.g. `h-5 w-5 text-brand-600`) via className.
export default function Spinner({ className = 'h-5 w-5 text-brand-600' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="17 40" />
    </svg>
  )
}

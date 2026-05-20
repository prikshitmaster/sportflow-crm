const IS_DEV = import.meta.env.DEV

export default function DevFillButton({ onFill }) {
  if (!IS_DEV) return null
  return (
    <button
      type="button"
      onClick={onFill}
      className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200 active:scale-95 transition select-none"
    >
      Fill Demo
    </button>
  )
}

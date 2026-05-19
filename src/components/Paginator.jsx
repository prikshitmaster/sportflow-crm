import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

const PAGE_SIZE = 25

function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = [1]
  if (current > 3) pages.push('...')
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
  if (current < total - 2) pages.push('...')
  pages.push(total)
  return pages
}

export default function Paginator({ page, total, pageSize = PAGE_SIZE, onChange }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end   = Math.min(page * pageSize, total)

  return (
    <div className="flex items-center justify-between px-1 py-2 flex-wrap gap-2">
      <p className="text-xs text-gray-400 font-medium">{start}–{end} of {total}</p>
      <div className="flex items-center gap-0.5">
        <button disabled={page === 1} onClick={() => onChange(1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition">
          <ChevronsLeft size={14} className="text-gray-600"/>
        </button>
        <button disabled={page === 1} onClick={() => onChange(page - 1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition">
          <ChevronLeft size={14} className="text-gray-600"/>
        </button>
        {pageNumbers(page, totalPages).map((p, i) =>
          p === '...'
            ? <span key={`d${i}`} className="px-1 text-xs text-gray-400">…</span>
            : <button key={p} onClick={() => onChange(p)}
                className={`w-7 h-7 rounded-lg text-xs font-semibold transition ${p === page ? 'bg-brand-600 text-white' : 'hover:bg-gray-100 text-gray-700'}`}>
                {p}
              </button>
        )}
        <button disabled={page === totalPages} onClick={() => onChange(page + 1)}
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition">
          <ChevronRight size={14} className="text-gray-600"/>
        </button>
        <button disabled={page === totalPages} onClick={() => onChange(totalPages)}
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition">
          <ChevronsRight size={14} className="text-gray-600"/>
        </button>
      </div>
    </div>
  )
}

export { PAGE_SIZE }

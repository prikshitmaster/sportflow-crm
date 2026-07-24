import { useState, useRef, useEffect, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, X, Send, Loader2, User, UserCog, Layers, CreditCard, ChevronRight } from 'lucide-react'
import { askAiAssistant } from '../lib/db'
import { useApp } from '../context/AppContext'

const ENTITY_ICON = { student: User, coach: UserCog, batch: Layers, payment: CreditCard }
// Staff portal users only get chips for record types they may open.
const ENTITY_PERM = { student: 'students.view', coach: 'staff.manage', batch: 'batches.view', payment: 'payments.view' }

// Renders **bold**, "- "/"* " bullet lists, and "1. " numbered lists from the
// model's markdown-flavored text. Not a full markdown parser — just the
// subset that makes numbers/stats answers scannable instead of a wall of text.
function renderInline(text, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>
  })
}

function renderMarkdownLite(text) {
  const lines = text.split('\n')
  const blocks = []
  let list = null // { type: 'ul' | 'ol', items: [] }

  const flushList = () => {
    if (!list) return
    const Tag = list.type
    blocks.push(
      <Tag key={`list-${blocks.length}`} className={Tag === 'ul' ? 'list-disc pl-4 space-y-0.5' : 'list-decimal pl-4 space-y-0.5'}>
        {list.items.map((item, i) => <li key={i}>{renderInline(item, `li-${blocks.length}-${i}`)}</li>)}
      </Tag>
    )
    list = null
  }

  lines.forEach((line, idx) => {
    const bullet = line.match(/^\s*[-*]\s+(.*)/)
    const numbered = line.match(/^\s*\d+\.\s+(.*)/)
    if (bullet) {
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] } }
      list.items.push(bullet[1])
    } else if (numbered) {
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] } }
      list.items.push(numbered[1])
    } else {
      flushList()
      if (line.trim()) blocks.push(<p key={`p-${idx}`}>{renderInline(line, `p-${idx}`)}</p>)
    }
  })
  flushList()
  return blocks
}

// Floating chat widget — owner/office-staff only (gated by callers via
// hasPermission before mounting). Talks to the ai-assistant edge function,
// which enforces the same academy scoping server-side regardless of what
// this component sends.
export default function AiAssistant() {
  const { role, user, selectedBranch, hasPermission } = useApp()
  const navigate = useNavigate()
  // Same "effective viewer branch" pattern used elsewhere in the app
  // (AppContext.jsx): owners follow the branch switcher, staff are locked
  // to their own assigned branch.
  const branchId = selectedBranch || (role === 'staff' ? (user?.branchId || null) : null)

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'assistant', text: "Ask me about students, fees, payments, attendance, performance, batches, staff, or trials." },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open])

  const send = async () => {
    const question = input.trim()
    if (!question || loading) return
    setInput('')
    // Cap history sent to the model — last 8 turns is plenty of context
    // without letting token usage/cost grow unbounded per message.
    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-8)
      .map(m => ({ role: m.role, content: m.text }))
    setMessages(m => [...m, { role: 'user', text: question }])
    setLoading(true)
    try {
      const { answer, entities } = await askAiAssistant(question, history, branchId)
      setMessages(m => [...m, { role: 'assistant', text: answer, entities }])
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', text: `⚠️ ${err.message || 'Something went wrong'}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-24 lg:bottom-6 right-4 lg:right-6 z-40 w-14 h-14 rounded-full bg-brand-600 text-white shadow-lg flex items-center justify-center hover:bg-brand-700 active:scale-95 transition"
        title="AI Assistant"
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {open && (
        <div className="fixed bottom-[10.5rem] lg:bottom-24 right-4 lg:right-6 z-40 w-[min(360px,calc(100vw-2rem))] h-[min(480px,calc(100vh-14rem))] bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 bg-brand-600 text-white flex-shrink-0">
            <Bot size={16} />
            <span className="font-semibold text-sm">AI Assistant</span>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {messages.map((m, i) => {
              const chips = (m.entities || []).filter(e =>
                ENTITY_ICON[e.type] && (role !== 'staff' || hasPermission(ENTITY_PERM[e.type]))
              )
              return (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm space-y-1 ${
                    m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {m.role === 'assistant' ? renderMarkdownLite(m.text) : m.text}
                    {chips.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-gray-200/70 mt-1.5">
                        {chips.map(e => {
                          const Icon = ENTITY_ICON[e.type]
                          return (
                            <button
                              key={`${e.type}-${e.id}`}
                              onClick={() => navigate(`${role === 'staff' ? '/staff' : ''}/detail/${e.type}/${e.id}`)}
                              className="flex items-center gap-1 text-xs font-semibold text-brand-700 bg-white border border-brand-200 rounded-full pl-2 pr-1.5 py-1 hover:bg-brand-50 hover:border-brand-300 transition"
                              title={`Open ${e.type} details`}
                            >
                              <Icon size={11} /> {e.label} <ChevronRight size={11} className="text-brand-300" />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-500 rounded-xl px-3 py-2 text-sm flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> Looking that up…
                </div>
              </div>
            )}
          </div>

          <div className="p-2.5 border-t border-gray-100 flex items-center gap-2 flex-shrink-0">
            <input
              className="input flex-1 text-sm"
              placeholder="e.g. Is Aaryan Patel overdue?"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send() }}
              disabled={loading}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="w-9 h-9 rounded-lg bg-brand-600 text-white flex items-center justify-center disabled:opacity-40 hover:bg-brand-700 transition flex-shrink-0"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

import { useState } from 'react'
import { Download, MessageCircle, Mail, Check } from 'lucide-react'
import { downloadReceiptHTML, sendReceiptViaWhatsApp, sendReceiptViaEmail } from '../lib/receiptShare'

// Download / WhatsApp / Email row for a receipt, shared by the student
// registration receipt and the trial fee receipt. No real send API behind
// this yet — see lib/receiptShare.js for what each button actually does
// and what changes once one is wired up.
export default function ReceiptActions({ html, filename, whatsappPhone, whatsappText, emailTo, emailSubject, emailBody }) {
  const [sentVia, setSentVia] = useState(null) // 'whatsapp' | 'email', briefly, for a confirm tick

  const flash = (channel) => { setSentVia(channel); setTimeout(() => setSentVia(null), 2000) }

  return (
    <div className="grid grid-cols-3 gap-2">
      <button type="button" onClick={() => downloadReceiptHTML(html, filename)}
        className="flex flex-col items-center gap-1 py-3 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition text-xs font-semibold">
        <Download size={16} /> Download
      </button>
      <button type="button"
        onClick={async () => {
          const r = await sendReceiptViaWhatsApp(html, filename, { phone: whatsappPhone, text: whatsappText })
          if (r !== 'cancelled') flash('whatsapp')
        }}
        className="flex flex-col items-center gap-1 py-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition text-xs font-semibold">
        {sentVia === 'whatsapp' ? <Check size={16} /> : <MessageCircle size={16} />}
        WhatsApp
      </button>
      <button type="button"
        onClick={async () => {
          const r = await sendReceiptViaEmail(html, filename, { to: emailTo, subject: emailSubject, body: emailBody })
          if (r !== 'cancelled') flash('email')
        }}
        className="flex flex-col items-center gap-1 py-3 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition text-xs font-semibold">
        {sentVia === 'email' ? <Check size={16} className="text-emerald-600" /> : <Mail size={16} />}
        Email
      </button>
    </div>
  )
}

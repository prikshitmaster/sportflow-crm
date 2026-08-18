// receiptPDF.js — SPIKE: rasterizes the existing receipt HTML (paymentReceipt.js)
// into a real single-page A4 PDF and uploads it to the public 'receipts'
// bucket, so an outside provider (Twilio now, Meta later) can fetch it via a
// plain HTTPS MediaUrl. Same html2canvas + jsPDF technique as sessionPDF.js.
//
// Throwaway alongside whatsapp-send-test — the production rail
// (2026-08-13-whatsapp-fee-reminders-design.md) will need its own decision
// on PDF generation (likely server-side, so it doesn't depend on a browser
// tab staying open after the payment is recorded).

import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { supabase } from './supabase'

async function renderToPDF(html) {
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  container.style.width = '794px' // ~210mm @ 96dpi
  document.body.appendChild(container)

  // Render inside an iframe so the receipt's own @page/full-document <style>
  // (paymentReceipt.js emits a whole <html><head>...) applies cleanly,
  // instead of fighting the host page's styles via innerHTML injection.
  const iframe = document.createElement('iframe')
  iframe.style.width = '794px'
  iframe.style.height = '1123px' // ~297mm @ 96dpi
  iframe.style.border = 'none'
  container.appendChild(iframe)

  try {
    await new Promise((resolve) => {
      iframe.onload = resolve
      iframe.srcdoc = html
    })
    const doc = iframe.contentDocument
    const canvas = await html2canvas(doc.body, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 794 })

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    pdf.addImage(imgData, 'JPEG', 0, 0, 210, (canvas.height * 210) / canvas.width)

    return pdf.output('blob')
  } finally {
    document.body.removeChild(container)
  }
}

/** Renders, uploads to the public receipts bucket, returns the public URL. */
export async function generateAndUploadReceiptPDF(html, paymentId) {
  const blob = await renderToPDF(html)
  const path = `${paymentId}.pdf`
  const { error: upErr } = await supabase.storage.from('receipts').upload(path, blob, {
    upsert: true,
    contentType: 'application/pdf',
  })
  if (upErr) throw upErr
  const { data: { publicUrl } } = supabase.storage.from('receipts').getPublicUrl(path)
  return publicUrl
}

import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

// Saves/shares a file cross-platform.
// Web: normal <a download> blob click — works fine in a real browser.
// Native (Capacitor WebView): <a download> is silently a no-op there — no
// browser download manager exists to catch it. Instead we write the blob to
// the app's cache dir and hand it to the native Share sheet so the user can
// save it to Downloads/Drive/WhatsApp/etc.
export async function saveOrShareFile(blob, filename) {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return
  }

  const base64 = await blobToBase64(blob)
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  })
  await Share.share({ title: filename, url: uri })
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

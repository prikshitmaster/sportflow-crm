// Compress an image file using the browser's Canvas API.
// Works on iOS Safari (HEIC decoded automatically), Android Chrome, and desktop.
// Falls back to the original file if anything fails — never throws.
export async function compressImage(file, { maxSize = 800, quality = 0.82 } = {}) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(file)
    }

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      try {
        const { width, height } = img
        const scale = Math.min(1, maxSize / Math.max(width, height))
        const w = Math.round(width * scale)
        const h = Math.round(height * scale)

        const canvas = document.createElement('canvas')
        canvas.width  = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)

        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return }
            // If compressed version is larger than original, keep original
            if (blob.size >= file.size) { resolve(file); return }
            resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
          },
          'image/jpeg',
          quality
        )
      } catch {
        resolve(file)
      }
    }

    img.src = objectUrl
  })
}

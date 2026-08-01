// The real Khelit "K" mark — matches the actual app icon / Play Store
// listing (public/icon-512.svg), not a generic icon-library glyph.
export default function BrandMark({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className}>
      <g stroke="currentColor" strokeWidth="11" strokeLinecap="round">
        <line x1="33" y1="25" x2="33" y2="75" />
        <line x1="39" y1="50" x2="72" y2="23" />
        <line x1="39" y1="50" x2="72" y2="77" />
      </g>
    </svg>
  )
}

export default function StudentAvatar({ photoUrl, name, size = 32 }) {
  const initial = name?.[0]?.toUpperCase() || '?'
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        loading="lazy"
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="rounded-full bg-brand-100 flex items-center justify-center font-bold text-brand-700 flex-shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initial}
    </div>
  )
}

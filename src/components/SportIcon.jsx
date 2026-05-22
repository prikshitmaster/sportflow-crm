// Sport-specific line icons matching the lucide aesthetic.
// All icons use currentColor so they inherit the per-sport theme color
// from the parent's `text-*` utility class.

import { Trophy } from 'lucide-react'

export default function SportIcon({ sport, size = 22, className = '' }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
  }

  switch (sport) {
    // ── Football (soccer ball) ────────────────────────────
    case 'Football':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <polygon points="12,7 8.5,9.5 10,13.5 14,13.5 15.5,9.5" />
          <path d="M12 2v5M12 17v5M2 12h5m10 0h5" />
          <path d="M5 5l3 4.5M19 5l-3 4.5M5 19l3-5.5M19 19l-3-5.5" />
        </svg>
      )

    // ── Cricket (bat + ball) ──────────────────────────────
    case 'Cricket':
      return (
        <svg {...p}>
          <path d="M14 4l6 6L8 22 2 16z" />
          <line x1="17" y1="3" x2="21" y2="7" />
          <circle cx="4.5" cy="19.5" r="1.7" fill="currentColor" />
        </svg>
      )

    // ── Tennis (racket) ───────────────────────────────────
    case 'Tennis':
      return (
        <svg {...p}>
          <ellipse cx="9" cy="9" rx="6.5" ry="7" />
          <line x1="13.5" y1="14" x2="21" y2="22" />
          <path d="M3 9h12M9 2v14" strokeWidth="1" opacity="0.6" />
        </svg>
      )

    // ── Squash (racket — narrower head) ───────────────────
    case 'Squash':
      return (
        <svg {...p}>
          <ellipse cx="9" cy="9" rx="5.5" ry="6.5" />
          <line x1="13" y1="14" x2="21" y2="22" />
          <circle cx="17" cy="6" r="1.5" fill="currentColor" />
        </svg>
      )

    // ── Basketball ────────────────────────────────────────
    case 'Basketball':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2v20M2 12h20" />
          <path d="M4.5 4.5 Q12 12, 4.5 19.5" />
          <path d="M19.5 4.5 Q12 12, 19.5 19.5" />
        </svg>
      )

    // ── Badminton (shuttlecock) ───────────────────────────
    case 'Badminton':
      return (
        <svg {...p}>
          <circle cx="12" cy="18" r="3" fill="currentColor" />
          <path d="M12 15 L7 3 M12 15 L17 3 M12 15 L9 3 M12 15 L15 3 M12 15 L12 3" />
          <path d="M8 5 L16 5" strokeWidth="1" opacity="0.5" />
        </svg>
      )

    // ── Table Tennis (paddle) ─────────────────────────────
    case 'Table Tennis':
      return (
        <svg {...p}>
          <circle cx="9" cy="9" r="6.5" />
          <line x1="13.5" y1="13.5" x2="20" y2="20" strokeWidth="2.5" />
          <circle cx="20" cy="6" r="1.5" fill="currentColor" />
        </svg>
      )

    // ── Hockey (stick + puck) ─────────────────────────────
    case 'Hockey':
      return (
        <svg {...p}>
          <path d="M3 4 L18 19 Q20 21, 22 19 L22 17" />
          <ellipse cx="5" cy="21" rx="2.5" ry="1.2" fill="currentColor" />
        </svg>
      )

    // ── Volleyball ────────────────────────────────────────
    case 'Volleyball':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2 Q4 8, 4 17" />
          <path d="M12 2 Q20 8, 20 17" />
          <path d="M2 12 Q10 14, 18 22" />
          <path d="M22 12 Q14 14, 6 22" />
        </svg>
      )

    // ── Swimming (wave + figure) ──────────────────────────
    case 'Swimming':
      return (
        <svg {...p}>
          <circle cx="17" cy="6" r="2" fill="currentColor" />
          <path d="M3 11 L8 13 L11 11 L14 13 L19 11" />
          <path d="M2 16 Q6 14, 10 16 T18 16 T22 16" />
          <path d="M2 20 Q6 18, 10 20 T18 20 T22 20" />
        </svg>
      )

    default:
      return <Trophy size={size} className={className} />
  }
}

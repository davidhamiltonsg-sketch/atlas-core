import { useId } from "react"
import type { ConstitutionId } from "@/lib/constitutions"

// Brand crests. A matched heraldic family: shared shield silhouette + gold
// accents signal the same house; the charge inside tells each portfolio's
// story. Atlas Core — the celestial sphere of Atlas, crowned, cradled in
// gold (bearing the world, royal purple). Silicon Brick Road — a brick road
// rising in perspective toward a long investment horizon, edged with silicon
// circuit traces, in luminous blues. Pure SVG, self-contained gradients,
// legible from 16px favicons to full-bleed hero placements.

const SHIELD =
  "M32 3.5C38.4 6.4 46.9 8.2 54.9 8.8C56.1 8.9 57 9.9 57 11.1V29C57 45.4 46.5 55.6 32.9 60.3C32.3 60.5 31.7 60.5 31.1 60.3C17.5 55.6 7 45.4 7 29V11.1C7 9.9 7.9 8.9 9.1 8.8C17.1 8.2 25.6 6.4 32 3.5Z"

const STAR =
  "M0 -2.4L0.65 -0.65L2.4 0L0.65 0.65L0 2.4L-0.65 0.65L-2.4 0L-0.65 -0.65Z"

function useSvgId() {
  return useId().replace(/[^a-zA-Z0-9]/g, "")
}

export function AtlasCoreMark({ className }: { className?: string }) {
  const uid = useSvgId()
  const id = (s: string) => `ac${uid}${s}`
  const url = (s: string) => `url(#${id(s)})`
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Atlas Core crest">
      <defs>
        <linearGradient id={id("fill")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b1157" />
          <stop offset="1" stopColor="#150829" />
        </linearGradient>
        <linearGradient id={id("edge")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="0.55" stopColor="#c084fc" />
          <stop offset="1" stopColor="#e879f9" />
        </linearGradient>
        <linearGradient id={id("orb")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ddd6fe" />
          <stop offset="1" stopColor="#f0abfc" />
        </linearGradient>
        <linearGradient id={id("gold")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6e27a" />
          <stop offset="0.55" stopColor="#dfaf4b" />
          <stop offset="1" stopColor="#b07d2e" />
        </linearGradient>
      </defs>

      {/* Shield */}
      <path d={SHIELD} fill={url("fill")} stroke={url("edge")} strokeWidth="1.6" />
      <path
        d={SHIELD}
        fill="none"
        stroke={url("gold")}
        strokeWidth="0.9"
        opacity="0.5"
        transform="translate(32 31.8) scale(0.9) translate(-32 -31.8)"
      />
      <ellipse cx="32" cy="13.5" rx="19" ry="8" fill="#ffffff" opacity="0.05" />

      {/* Crown */}
      <path
        d="M24.5 17.5L26.8 11.2L30 15.2L32 9.5L34 15.2L37.2 11.2L39.5 17.5Z"
        fill={url("gold")}
      />

      {/* Celestial sphere — the world Atlas bears */}
      <g stroke={url("orb")} fill="none">
        <circle cx="32" cy="31" r="10.5" strokeWidth="1.5" />
        <ellipse cx="32" cy="31" rx="10.5" ry="3.9" strokeWidth="1" opacity="0.9" />
        <ellipse cx="32" cy="31" rx="3.9" ry="10.5" strokeWidth="1" opacity="0.9" />
        <ellipse
          cx="32" cy="31" rx="14.5" ry="4.6"
          strokeWidth="1.1" opacity="0.75"
          transform="rotate(-20 32 31)"
        />
      </g>

      {/* Gold cradle — strength beneath the sphere */}
      <path
        d="M20.8 42.2Q32 50.5 43.2 42.2"
        fill="none"
        stroke={url("gold")}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="20.8" cy="42.2" r="1.15" fill={url("gold")} />
      <circle cx="43.2" cy="42.2" r="1.15" fill={url("gold")} />

      {/* Attendant stars */}
      <path d={STAR} transform="translate(16 24)" fill={url("gold")} opacity="0.9" />
      <path d={STAR} transform="translate(48 24)" fill={url("gold")} opacity="0.9" />
    </svg>
  )
}

export function SbrMark({ className }: { className?: string }) {
  const uid = useSvgId()
  const id = (s: string) => `sbr${uid}${s}`
  const url = (s: string) => `url(#${id(s)})`
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Silicon Brick Road crest">
      <defs>
        <linearGradient id={id("fill")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c2a52" />
          <stop offset="1" stopColor="#06152c" />
        </linearGradient>
        <linearGradient id={id("edge")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38bdf8" />
          <stop offset="0.55" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        {/* userSpaceOnUse: one gradient over the whole road, so each course
            of bricks glows brighter as the road climbs toward the goal */}
        <linearGradient id={id("road")} gradientUnits="userSpaceOnUse" x1="32" y1="53" x2="32" y2="24">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="0.6" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#7dd3fc" />
        </linearGradient>
        <linearGradient id={id("gold")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6e27a" />
          <stop offset="0.55" stopColor="#dfaf4b" />
          <stop offset="1" stopColor="#b07d2e" />
        </linearGradient>
      </defs>

      {/* Shield */}
      <path d={SHIELD} fill={url("fill")} stroke={url("edge")} strokeWidth="1.6" />
      <path
        d={SHIELD}
        fill="none"
        stroke={url("gold")}
        strokeWidth="0.9"
        opacity="0.5"
        transform="translate(32 31.8) scale(0.9) translate(-32 -31.8)"
      />
      <ellipse cx="32" cy="13.5" rx="19" ry="8" fill="#ffffff" opacity="0.05" />

      {/* The brick road, rising in perspective */}
      <g fill={url("road")}>
        <path d="M21 52L43 52L41.4 45.8L22.6 45.8Z" />
        <path d="M23.1 43.8L40.9 43.8L39.6 38.6L24.4 38.6Z" />
        <path d="M24.9 36.6L39.1 36.6L38 32.2L26 32.2Z" />
        <path d="M26.3 30.4L37.7 30.4L36.9 25.9L27.1 25.9Z" />
      </g>
      {/* Staggered mortar joints */}
      <g stroke="#0a1f3d" strokeWidth="1.2">
        <path d="M32 52L32 45.8" />
        <path d="M28.6 43.8L28.9 38.6" />
        <path d="M35.4 43.8L35.1 38.6" />
        <path d="M32 36.6L32 32.2" />
        <path d="M29.7 30.4L29.9 25.9" />
        <path d="M34.3 30.4L34.1 25.9" />
      </g>

      {/* The golden home — where the road leads */}
      <path
        d="M25.5 21.5V15.3L32 9.8L38.5 15.3V21.5ZM30.6 21.5V17.2H33.4V21.5Z"
        fill={url("gold")}
        fillRule="evenodd"
      />

      {/* Silicon traces */}
      <g stroke="#22d3ee" strokeWidth="1.2" fill="none" opacity="0.85">
        <path d="M18.5 48.5V42.5H21.5" />
        <path d="M45.5 48.5V42.5H42.5" />
      </g>
      <circle cx="18.5" cy="50.6" r="1.2" fill="#22d3ee" opacity="0.85" />
      <circle cx="45.5" cy="50.6" r="1.2" fill="#22d3ee" opacity="0.85" />
    </svg>
  )
}

export function BrandMark({
  constitutionId,
  className,
}: {
  constitutionId: ConstitutionId
  className?: string
}) {
  return constitutionId === "silicon-brick-road" ? (
    <SbrMark className={className} />
  ) : (
    <AtlasCoreMark className={className} />
  )
}

// Atlas Universe — the meta-brand's own mark. Same shield family as the two
// portfolio crests (silhouette + gold filigree rim, so it reads as kin to
// both), but its own charge: two interlocking rings — violet (Atlas) and sky
// (Silicon Brick Road) — meeting at a single gold star where they overlap.
// "Two constitutions, one discipline" made literal, not just stated in copy.
export function AtlasUniverseMark({ className }: { className?: string }) {
  const uid = useSvgId()
  const id = (s: string) => `au${uid}${s}`
  const url = (s: string) => `url(#${id(s)})`
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Atlas Universe crest">
      <defs>
        <linearGradient id={id("fill")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1a1030" />
          <stop offset="1" stopColor="#071a2e" />
        </linearGradient>
        <linearGradient id={id("edge")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="0.5" stopColor="#dfaf4b" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
        <linearGradient id={id("gold")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6e27a" />
          <stop offset="0.55" stopColor="#dfaf4b" />
          <stop offset="1" stopColor="#b07d2e" />
        </linearGradient>
        <linearGradient id={id("violetRing")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <linearGradient id={id("skyRing")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>

      {/* Shield */}
      <path d={SHIELD} fill={url("fill")} stroke={url("edge")} strokeWidth="1.6" />
      <path
        d={SHIELD}
        fill="none"
        stroke={url("gold")}
        strokeWidth="0.9"
        opacity="0.5"
        transform="translate(32 31.8) scale(0.9) translate(-32 -31.8)"
      />
      <ellipse cx="32" cy="13.5" rx="19" ry="8" fill="#ffffff" opacity="0.05" />

      {/* Crown */}
      <path
        d="M24.5 17.5L26.8 11.2L30 15.2L32 9.5L34 15.2L37.2 11.2L39.5 17.5Z"
        fill={url("gold")}
      />

      {/* Two interlocking rings — the two constitutions */}
      <circle cx="26.5" cy="31.5" r="9.5" fill="none" stroke={url("violetRing")} strokeWidth="1.7" />
      <circle cx="37.5" cy="31.5" r="9.5" fill="none" stroke={url("skyRing")} strokeWidth="1.7" />

      {/* The one discipline — where they meet */}
      <path d={STAR} transform="translate(32 31.5) scale(1.15)" fill={url("gold")} />

      {/* Gold cradle — strength beneath both houses */}
      <path
        d="M16.5 43.2Q32 52.5 47.5 43.2"
        fill="none"
        stroke={url("gold")}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="16.5" cy="43.2" r="1.15" fill={url("gold")} />
      <circle cx="47.5" cy="43.2" r="1.15" fill={url("gold")} />
    </svg>
  )
}

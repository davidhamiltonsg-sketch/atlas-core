import type { ComponentType } from "react"

// Shared rotating-halo treatment for brand crests — a slow conic-gradient ring
// (masked down to a thin outline) spins around the mark while it gently
// floats, with a color-matched glow beneath. Originally built for the app
// router loading splash; reused wherever a crest appears pre-auth (portfolio
// chooser, login) so the "live system" motif is consistent everywhere.
export const SPIN_THEME = {
  "atlas-core": {
    conic: "conic-gradient(from 0deg, transparent 0%, #a78bfa 20%, #c084fc 45%, #e879f9 60%, transparent 80%)",
    glow: "0 12px 30px rgba(124,58,237,0.45)",
  },
  "silicon-brick-road": {
    conic: "conic-gradient(from 0deg, transparent 0%, #38bdf8 20%, #3b82f6 45%, #22d3ee 60%, transparent 80%)",
    glow: "0 12px 30px rgba(14,165,233,0.45)",
  },
  universe: {
    conic: "conic-gradient(from 0deg, transparent 0%, #a78bfa 20%, #dfaf4b 45%, #38bdf8 60%, transparent 80%)",
    glow: "0 14px 34px rgba(223,175,75,0.35)",
  },
} as const

export function SpinningMark({
  Mark,
  conic,
  glowShadow,
  size = "h-20 w-20",
  ringInset = "-inset-4",
  className = "",
}: {
  Mark: ComponentType<{ className?: string }>
  conic: string
  glowShadow: string
  size?: string
  ringInset?: string
  className?: string
}) {
  return (
    <div className={`relative float-soft ${className}`}>
      <div
        className={`absolute ${ringInset} rounded-full animate-spin`}
        style={{
          animationDuration: "2.8s",
          background: conic,
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
        }}
      />
      <div className="relative" style={{ filter: `drop-shadow(${glowShadow})` }}>
        <Mark className={size} />
      </div>
    </div>
  )
}

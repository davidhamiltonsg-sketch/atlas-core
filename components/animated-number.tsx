"use client"

import { useEffect, useRef } from "react"
import { formatMoney, type Currency } from "@/lib/money"

// Count-up display for hero metrics. The server renders the FINAL formatted
// value (correct without JS, no layout shift); after hydration the number
// rolls up from zero with an ease-out curve by writing textContent directly —
// no state, no re-renders. Honours prefers-reduced-motion by not animating.
//
// The currency branch delegates to lib/money's formatMoney, so the animated
// value is structurally byte-identical to formatCurrency output.

interface AnimatedNumberProps {
  value: number
  currency?: Currency
  decimals?: number
  suffix?: string
  duration?: number
  // Delay before the count-up starts — lets a number wait for a sibling animation
  // (e.g. the governance seal's ring sweep) so they read as one staged reveal
  // instead of two motions blurring together at once.
  delay?: number
  className?: string
}

function fmt(n: number, currency: Currency | undefined, decimals: number, suffix: string): string {
  const body = currency
    ? formatMoney({ amount: n, ccy: currency })
    : n.toLocaleString("en-SG", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
  return `${body}${suffix}`
}

export function AnimatedNumber({
  value,
  currency,
  decimals = 0,
  suffix = "",
  duration = 1000,
  delay = 0,
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = fmt(value, currency, decimals, suffix)
      return
    }
    let raf = 0
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      const start = performance.now()
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration)
        const eased = 1 - Math.pow(1 - p, 3)
        el.textContent = fmt(value * eased, currency, decimals, suffix)
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }, delay)
    return () => { cancelled = true; window.clearTimeout(timer); cancelAnimationFrame(raf) }
  }, [value, currency, decimals, suffix, duration, delay])

  return (
    <span ref={ref} className={className}>
      {fmt(value, currency, decimals, suffix)}
    </span>
  )
}

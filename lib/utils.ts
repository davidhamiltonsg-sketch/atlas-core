import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatMoney, type Currency } from "@/lib/money"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Legacy call-shape kept so existing call-sites don't churn; delegates to the single
// Money formatter (lib/money.ts) so there is one formatting implementation. Output is
// unchanged. New code should prefer formatMoney(Money) directly.
export function formatCurrency(value: number, currency = "SGD"): string {
  return formatMoney({ amount: value, ccy: currency as Currency })
}

export function formatPercent(value: number, decimals = 1, signed = true): string {
  const str = `${Math.abs(value).toFixed(decimals)}%`
  if (!signed) return str
  return value >= 0 ? `+${str}` : `-${str}`
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date))
}

"use client"

// Minimal cross-component "is a data refresh in flight" signal, via useSyncExternalStore.
// Avoids needing a Context Provider wrapped around the page's JSX tree just to let one
// button (RefreshPricesButton) tell a sibling table (HoldingsTableInteractive) to show a
// loading skeleton while a refresh is pending.

let refreshing = false
const listeners = new Set<() => void>()

export function setRefreshing(value: boolean): void {
  if (refreshing === value) return
  refreshing = value
  listeners.forEach(l => l())
}

export function subscribeRefreshing(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function getRefreshingSnapshot(): boolean {
  return refreshing
}

export function getRefreshingServerSnapshot(): boolean {
  return false
}

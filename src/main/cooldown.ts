export interface Cooldown {
  isCooling(now?: number): boolean
  remainingMs(now?: number): number
  mark(now?: number): void
}

export function makeCooldown(ms: number): Cooldown {
  let lastFireAt: number | undefined

  function remainingMs(now = Date.now()): number {
    if (lastFireAt === undefined) {
      return 0
    }
    const elapsed = now - lastFireAt
    return Math.max(0, ms - elapsed)
  }

  return {
    isCooling(now = Date.now()): boolean {
      return remainingMs(now) > 0
    },
    remainingMs,
    mark(now = Date.now()): void {
      lastFireAt = now
    }
  }
}

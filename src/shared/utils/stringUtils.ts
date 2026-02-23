export function clampByCodePoints(text: string, maxLength: number): string {
  const chars = Array.from(text)
  if (chars.length <= maxLength) {
    return text
  }
  return chars.slice(0, maxLength).join('')
}

export function trimAndClampByCodePoints(text: string, maxLength: number): string {
  return clampByCodePoints(text.trim(), maxLength)
}

export function codePointLength(text: string): number {
  return Array.from(text).length
}

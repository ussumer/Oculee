function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteMinutes = Math.abs(offsetMinutes)
  const hours = Math.floor(absoluteMinutes / 60)
  const minutes = absoluteMinutes % 60
  return `${sign}${pad(hours)}:${pad(minutes)}`
}

export function formatLocalIsoTimestamp(date: Date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${formatOffset(offsetMinutes)}`
}

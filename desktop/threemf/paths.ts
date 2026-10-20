export type Platform = 'windows' | 'posix'

let current: Platform = 'windows'

export function setPlatform(platform: Platform) {
  current = platform
}

export function getPlatform(): Platform {
  return current
}

export function separator(platform: Platform = current): string {
  return platform === 'windows' ? '\\' : '/'
}

export function isCaseInsensitive(platform: Platform = current): boolean {
  return platform === 'windows'
}

export function detectPlatform(): Platform {
  return 'posix'
}

export function parentDir(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index >= 0 ? filePath.slice(0, index) : ''
}

export function splitPath(value: string): string[] {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').split('/').filter(Boolean)
}

export function joinPath(segments: string[], platform: Platform = current): string {
  const parts = segments.filter((item) => item && item !== '.')
  const sep = separator(platform)
  if (!parts.length) return '.'
  if (platform === 'posix') return `/${parts.join('/')}`
  return parts.join(sep)
}
export function isAbsolutePath(value: string, platform: Platform = current): boolean {
  if (!value) return false
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true
  if (value.startsWith('\\\\')) return true
  return platform === 'posix' && value.startsWith('/')
}

export function equalPath(a: string, b: string, platform: Platform = current): boolean {
  return isCaseInsensitive(platform) ? a.toLowerCase() === b.toLowerCase() : a === b
}

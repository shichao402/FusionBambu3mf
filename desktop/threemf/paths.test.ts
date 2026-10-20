import { afterEach, describe, expect, it } from 'vitest'
import { normalizeExportDir, relativeExportDir, resolveExportDir } from './package'
import { detectPlatform, isAbsolutePath, joinPath, parentDir, setPlatform, splitPath } from './paths'

const DEFAULT = '变体'

afterEach(() => {
  setPlatform('windows')
})

describe('paths', () => {
  it('splits both slash styles regardless of platform', () => {
    expect(splitPath('/Users/me/模型/')).toEqual(['Users', 'me', '模型'])
    expect(splitPath('D:\\模型\\干燥盒.3mf')).toEqual(['D:', '模型', '干燥盒.3mf'])
    expect(splitPath('mixed\\风格/路径')).toEqual(['mixed', '风格', '路径'])
    expect(splitPath('')).toEqual([])
  })

  it('finds the parent directory for absolute and relative paths', () => {
    expect(parentDir('/Users/me/模型/干燥盒.3mf')).toBe('/Users/me/模型')
    expect(parentDir('D:\\模型\\干燥盒.3mf')).toBe('D:\\模型')
    expect(parentDir('干燥盒.3mf')).toBe('')
  })

  it('joins segments with the platform separator', () => {
    expect(joinPath(['Users', 'me'])) .toBe('Users\\me')
    setPlatform('posix')
    expect(joinPath(['Users', 'me'])).toBe('/Users/me')
    expect(joinPath([])).toBe('.')
  })

  it('recognizes absolute paths per platform', () => {
    expect(isAbsolutePath('D:\\模型', 'windows')).toBe(true)
    expect(isAbsolutePath('D:/模型', 'windows')).toBe(true)
    expect(isAbsolutePath('/Users/me', 'windows')).toBe(false)
    expect(isAbsolutePath('/Users/me', 'posix')).toBe(true)
    expect(isAbsolutePath('变体', 'posix')).toBe(false)
    expect(isAbsolutePath('', 'posix')).toBe(false)
  })

  it('detects posix hosts outside the browser', () => {
    expect(detectPlatform()).toBe('posix')
  })
})

describe('export dir on windows', () => {
  it('keeps backslash output and case insensitive matching', () => {
    expect(resolveExportDir('D:\\模型\\干燥盒.3mf', '变体')).toBe('D:\\模型\\变体')
    expect(resolveExportDir('D:\\模型\\干燥盒.3mf', '输出\\一批')).toBe('D:\\模型\\输出\\一批')
    expect(relativeExportDir('D:\\模型\\干燥盒.3mf', 'd:\\模型\\变体\\加长')).toBe('变体/加长')
    expect(relativeExportDir('D:\\模型\\干燥盒.3mf', 'E:\\其他')).toBeNull()
  })

  it('rejects folder paths and falls back to the default', () => {
    expect(normalizeExportDir('C:/绝对路径')).toBe(DEFAULT)
    expect(normalizeExportDir('C:\\绝对路径')).toBe(DEFAULT)
    expect(normalizeExportDir(undefined)).toBe(DEFAULT)
    expect(normalizeExportDir('   ')).toBe(DEFAULT)
    expect(normalizeExportDir('/')).toBe(DEFAULT)
    expect(normalizeExportDir('///')).toBe(DEFAULT)
  })
})

describe('export dir on posix', () => {
  it('joins with forward slashes', () => {
    setPlatform('posix')
    expect(resolveExportDir('/Users/me/模型/干燥盒.3mf', '变体')).toBe('/Users/me/模型/变体')
    expect(resolveExportDir('/Users/me/模型/干燥盒.3mf', '输出/一批')).toBe('/Users/me/模型/输出/一批')
    expect(resolveExportDir('/Users/me/模型/干燥盒.3mf', '..')).toBe('/Users/me')
  })

  it('treats absolute posix folder paths as valid', () => {
    setPlatform('posix')
    expect(normalizeExportDir('/Volumes/共享/变体')).toBe('/Volumes/共享/变体')
    expect(resolveExportDir('/Users/me/模型/干燥盒.3mf', '/Volumes/共享/变体')).toBe('/Volumes/共享/变体')
    expect(resolveExportDir('/Users/me/模型/干燥盒.3mf', '变体')).toBe('/Users/me/模型/变体')
  })

  it('compares prefixes case sensitively', () => {
    setPlatform('posix')
    expect(relativeExportDir('/Users/me/模型/干燥盒.3mf', '/Users/me/模型/变体')).toBe('变体')
    expect(relativeExportDir('/Users/me/模型/干燥盒.3mf', '/Users/me/模型/变体/加长')).toBe('变体/加长')
    expect(relativeExportDir('/Users/me/模型/干燥盒.3mf', '/Users/me/模型/干燥盒/变体')).toBe('干燥盒/变体')
    expect(relativeExportDir('/Users/me/模型/干燥盒.3mf', '/Volumes/其他')).toBeNull()
  })

  it('normalizes windows style input into a relative folder', () => {
    setPlatform('posix')
    expect(normalizeExportDir('输出\\一批')).toBe('输出/一批')
    expect(normalizeExportDir('C:\\绝对路径')).toBe(DEFAULT)
  })

  it('accepts mixed separators and leading slashes safely', () => {
    setPlatform('posix')
    expect(normalizeExportDir('/输出//一批/')).toBe('/输出/一批')
    expect(normalizeExportDir('//输出')).toBe(DEFAULT)
    expect(resolveExportDir('/Users/me/干燥盒.3mf', '混合\\风格/路径')).toBe('/Users/me/混合/风格/路径')
  })
})

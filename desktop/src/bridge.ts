const BASE = 'http://127.0.0.1:17890'

export type Health = {
  ok: boolean
  version: string
  documentName: string
  hasDesign: boolean
}

export type ParameterInfo = {
  name: string
  expression: string
  comment: string
  unit: string
}

export type StructureNode = {
  kind: 'component' | 'body'
  name: string
  componentName: string
  path: string
  children: StructureNode[]
}

async function request(method: string, path: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || response.statusText)
  return payload
}

export function getHealth(): Promise<Health> {
  return request('GET', '/health')
}

export function getParameters(): Promise<{ parameters: ParameterInfo[] }> {
  return request('GET', '/parameters')
}

export function getStructure(): Promise<{ nodes: StructureNode[] }> {
  return request('GET', '/structure')
}

export function applyParameters(parameters: Record<string, string>, backup: boolean) {
  return request('POST', '/parameters/apply', { parameters, backup })
}

export function restoreParameters() {
  return request('POST', '/parameters/restore')
}

export function exportMesh(directory?: string): Promise<{ path: string }> {
  return request('POST', '/export/mesh3mf', directory ? { directory } : {})
}

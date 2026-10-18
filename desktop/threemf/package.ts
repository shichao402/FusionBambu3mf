import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { choiceFromParsed, emptyPrintChoice, presetSettings, writeChoice, type PrintChoice, type PrintPatch } from './presets'

const MODEL = '3D/3dmodel.model'
const SETTINGS = 'Metadata/model_settings.config'
const PROJECT = 'Metadata/project_settings.config'
const VARIANTS = 'Metadata/fusion_batch_variants.json'
const IDENTITY_MATRIX = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'
const IDENTITY_TRANSFORM = '1 0 0 0 1 0 0 0 1 0 0 0'
const BAMBU_APPLICATION = 'BambuStudio-02.08.02.61'
const PREVIOUS_APPLICATION = 'BambuStudio-01.09.07.50'
const SLICE_INFO = 'Metadata/slice_info.config'
const FILAMENT_SEQUENCE = 'Metadata/filament_sequence.json'
const CUT_INFORMATION = 'Metadata/cut_information.xml'
const CUSTOM_GCODE = 'Metadata/custom_gcode_per_layer.xml'
const VOLUME_SUBTYPES = new Set(['modifier_part', 'negative_part', 'support_enforcer', 'support_blocker'])

export type MetadataMap = Record<string, string>

export type PartRecord = {
  id: string
  subtype: string
  metadata: MetadataMap
}

export type ObjectRecord = {
  id: string
  metadata: MetadataMap
  parts: PartRecord[]
}

export type VariantRecord = {
  name: string
  parameters: Record<string, string>
}

export type MemberRecord = {
  path: string
  name: string
}

export const DEFAULT_EXPORT_DIR = '变体'

export type Project3mf = {
  files: Record<string, Uint8Array>
  objects: ObjectRecord[]
  plateXml: string
  assembleXml: string
  variants: VariantRecord[]
  exportDir: string
  members: MemberRecord[] | null
}

type XmlElement = {
  nodeType: number
  nodeName: string
  localName?: string
  childNodes: ArrayLike<XmlElement>
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  appendChild(node: XmlElement): XmlElement
  removeChild(node: XmlElement): XmlElement
}

const parser = new DOMParser()
const serializer = new XMLSerializer()

function tagName(node: XmlElement): string {
  return node.localName || node.nodeName
}

function elements(parent: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = []
  const nodes = parent.childNodes
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node && node.nodeType === 1 && tagName(node) === name) found.push(node)
  }
  return found
}

function first(parent: XmlElement, name: string): XmlElement | undefined {
  return elements(parent, name)[0]
}

function descendants(parent: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = []
  const walk = (node: XmlElement) => {
    const nodes = node.childNodes
    for (let index = 0; index < nodes.length; index += 1) {
      const child = nodes[index]
      if (!child || child.nodeType !== 1) continue
      if (tagName(child) === name) found.push(child)
      walk(child)
    }
  }
  walk(parent)
  return found
}

function parseXml(text: string): XmlElement {
  return parser.parseFromString(text, 'text/xml') as unknown as XmlElement
}

function xmlText(node: XmlElement): string {
  return serializer.serializeToString(node as never)
}

function metadataOf(node: XmlElement): MetadataMap {
  const metadata: MetadataMap = {}
  elements(node, 'metadata').forEach((item) => {
    const key = item.getAttribute('key')
    if (key) metadata[key] = item.getAttribute('value') || ''
  })
  return metadata
}

function keepFile(name: string): boolean {
  const base = name.split('/').pop() || name
  if (base === 'slice_info.config') return false
  if (base.startsWith('plate_') && base.endsWith('.gcode')) return false
  return true
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  const files = unzipSync(bytes)
  const kept: Record<string, Uint8Array> = {}
  Object.keys(files).forEach((name) => {
    if (keepFile(name)) kept[name] = files[name]
  })
  return kept
}

export function readProject(bytes: Uint8Array): Project3mf {
  const files = unzip(bytes)
  const settings = files[SETTINGS] ? strFromU8(files[SETTINGS]) : ''
  const parsed = settings ? parseSettings(settings) : { objects: [], plateXml: '', assembleXml: '' }
  const project = {
    files,
    objects: parsed.objects,
    plateXml: parsed.plateXml,
    assembleXml: parsed.assembleXml,
    ...readVariantFile(files[VARIANTS]),
  }
  separateAssemblies(project)
  return project
}

function parseSettings(xml: string): { objects: ObjectRecord[]; plateXml: string; assembleXml: string } {
  const root = parseXml(xml)
  const config = descendants(root, 'config')[0] || root
  const objects = elements(config, 'object').map((objectNode) => ({
    id: objectNode.getAttribute('id') || '',
    metadata: metadataOf(objectNode),
    parts: elements(objectNode, 'part').map((partNode) => ({
      id: partNode.getAttribute('id') || '',
      subtype: partNode.getAttribute('subtype') || 'normal_part',
      metadata: metadataOf(partNode),
    })),
  }))
  const assemble = first(config, 'assemble')
  return {
    objects,
    plateXml: elements(config, 'plate').map((plate) => xmlText(plate)).join('\n'),
    assembleXml: assemble ? xmlText(assemble) : '',
  }
}

function readVariantFile(bytes: Uint8Array | undefined): { variants: VariantRecord[]; exportDir: string; members: MemberRecord[] | null } {
  if (!bytes) return { variants: [], exportDir: DEFAULT_EXPORT_DIR, members: null }
  const parsed = JSON.parse(strFromU8(bytes)) as { variants?: VariantRecord[]; exportDir?: unknown; members?: unknown }
  return {
    variants: parsed.variants || [],
    exportDir: normalizeExportDir(parsed.exportDir),
    members: readMembers(parsed.members),
  }
}

function readMembers(value: unknown): MemberRecord[] | null {
  if (!Array.isArray(value)) return null
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as { path?: unknown; name?: unknown }
    if (typeof record.path !== 'string' || !record.path || typeof record.name !== 'string' || !record.name) return []
    return [{ path: record.path, name: record.name }]
  })
}

export function membersFromAlignment(nodes: { path: string; keys: string[] }[], partNames: string[]): MemberRecord[] {
  const remaining = [...partNames]
  const members: MemberRecord[] = []
  nodes.forEach((node) => {
    const index = remaining.findIndex((name) => node.keys.includes(name))
    if (index < 0) return
    const name = remaining.splice(index, 1)[0]
    if (!name) return
    members.push({ path: node.path, name })
  })
  return members
}

export function normalizeExportDir(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_EXPORT_DIR
  const trimmed = value.trim().replaceAll('\\', '/')
  if (!trimmed || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/')) return DEFAULT_EXPORT_DIR
  const parts = trimmed.split('/').filter((part) => part && part !== '.')
  if (parts.some((part) => part.includes(':') || part.includes('\0'))) return DEFAULT_EXPORT_DIR
  return parts.join('/') || '.'
}

export function relativeExportDir(projectFile: string, absoluteDir: string): string | null {
  const from = splitPath(parentDir(projectFile))
  const to = splitPath(absoluteDir)
  if (!from.length || !to.length) return null
  if (from[0].toLowerCase() !== to[0].toLowerCase()) return null
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared].toLowerCase() === to[shared].toLowerCase()) shared += 1
  const relative = [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/')
  return normalizeExportDir(relative || '.')
}

export function resolveExportDir(projectFile: string, exportDir: string): string {
  const base = splitPath(parentDir(projectFile))
  const relative = normalizeExportDir(exportDir)
  if (!base.length) return relative
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (base.length > 1) base.pop()
    } else if (part !== '.') base.push(part)
  }
  return base.join('\\')
}

function parentDir(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index >= 0 ? filePath.slice(0, index) : ''
}

function splitPath(value: string): string[] {
  return value.replaceAll('/', '\\').replace(/\\+$/, '').split('\\').filter(Boolean)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function writeMetadata(metadata: MetadataMap, indent: string): string {
  return Object.keys(metadata)
    .map((key) => `${indent}<metadata key="${escapeXml(key)}" value="${escapeXml(metadata[key])}"/>`)
    .join('\n')
}

function defaultPlate(objectIds: string[]): string {
  const instances = objectIds.map((objectId) => `    <model_instance>
      <metadata key="object_id" value="${escapeXml(objectId)}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${escapeXml(objectId)}"/>
    </model_instance>`).join('\n')
  return `<plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="filament_map_mode" value="Auto For Flush"/>
${instances}
  </plate>`
}

function defaultAssemble(objects: { id: string; partCount: number }[]): string {
  const lines: string[] = []
  objects.forEach((objectNode) => {
    lines.push(`    <assemble_item object_id="${escapeXml(objectNode.id)}" instance_id="0" transform="${IDENTITY_TRANSFORM}" offset="0 0 0"/>`)
    for (let index = 0; index < objectNode.partCount; index += 1) {
      lines.push(`    <assemble_item object_id="${escapeXml(objectNode.id)}" volume_id="${index}" transform="${IDENTITY_TRANSFORM}"/>`)
    }
  })
  return `<assemble>\n${lines.join('\n')}\n  </assemble>`
}

function partUuid(id: string): string {
  const hex = id.replace(/\D/g, '').padStart(12, '0').slice(-12)
  return `00000000-0000-4000-8000-${hex || '000000000000'}`
}

function triangleCounts(modelXml: string): Map<string, number> {
  const counts = new Map<string, number>()
  const pattern = /<object\b([^>]*)>([\s\S]*?)<\/object>/g
  for (const match of modelXml.matchAll(pattern)) {
    const id = match[1].match(/\bid="([^"]+)"/)?.[1] || ''
    if (!id) continue
    counts.set(id, (match[2].match(/<triangle\b/g) || []).length)
  }
  return counts
}

function parsePlateNodes(plateXml: string): XmlElement[] {
  const trimmed = plateXml.trim()
  if (!trimmed) return []
  const parsed = parseXml(`<plates>${trimmed}</plates>`)
  const root = descendants(parsed, 'plates')[0] || parsed
  return elements(root, 'plate')
}

function ensurePlateMetadata(plateXml: string): string {
  const plates = parsePlateNodes(plateXml)
  if (!plates.length) return plateXml
  return plates.map((plate) => ensureOnePlate(xmlText(plate))).join('\n')
}

function ensureOnePlate(plateXml: string): string {
  const fields = [
    ['plater_name', ''],
    ['locked', 'false'],
    ['filament_map_mode', 'Auto For Flush'],
  ]
  let next = plateXml
  fields.forEach(([key, value]) => {
    if (next.includes(`key="${key}"`)) return
    next = next.replace(/<plate\b([^>]*)>/, `<plate$1>\n    <metadata key="${key}" value="${value}"/>`)
  })
  return next
}

function ensureVolumeItems(assembleXml: string, objects: ObjectRecord[]): string {
  if (assembleXml.includes('volume_id=')) return assembleXml
  const lines = objects.flatMap((objectNode) => objectNode.parts.map((_, index) => (
    `    <assemble_item object_id="${escapeXml(objectNode.id)}" volume_id="${index}" transform="${IDENTITY_TRANSFORM}"/>`
  )))
  if (!lines.length) return assembleXml
  return assembleXml.replace('</assemble>', `${lines.join('\n')}\n  </assemble>`)
}

export function writeSettings(project: Project3mf): string {
  const faces = triangleCounts(project.files[MODEL] ? strFromU8(project.files[MODEL]) : '')
  const objects = project.objects.map((objectNode) => {
    const parts = objectNode.parts.map((part) => {
      const count = faces.get(part.id) || 0
      const meta = writeMetadata(part.metadata, '      ')
      return `    <part id="${escapeXml(part.id)}" subtype="${escapeXml(part.subtype)}" uuid="${partUuid(part.id)}">
${meta}
      <mesh_stat face_count="${count}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>
    </part>`
    }).join('\n')
    const objectMeta = { ...objectNode.metadata }
    if (!objectMeta.extruder) objectMeta.extruder = '1'
    const faceCount = objectNode.parts.reduce((sum, part) => sum + (faces.get(part.id) || 0), 0)
    const meta = writeMetadata(objectMeta, '    ')
    return `  <object id="${escapeXml(objectNode.id)}">
${meta}
    <metadata face_count="${faceCount}"/>
${parts}
  </object>`
  }).join('\n')
  const listed = project.objects.filter((objectNode) => objectNode.id)
  const objectIds = listed.map((objectNode) => objectNode.id)
  const plate = ensurePlateMetadata(project.plateXml || defaultPlate(objectIds.length ? objectIds : ['1']))
  const assembleSource = project.assembleXml || defaultAssemble(
    (listed.length ? listed : [{ id: '1', parts: [{ id: '1' }] }]).map((objectNode) => ({ id: objectNode.id, partCount: objectNode.parts.length })),
  )
  const assemble = ensureVolumeItems(assembleSource, listed.length ? listed : [{ id: '1', metadata: {}, parts: [{ id: '1', subtype: 'normal_part', metadata: {} }] }])
  return `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${objects}\n  ${plate}\n  ${assemble}\n</config>\n`
}

function meshObjects(modelXml: string): { id: string; name: string }[] {
  const root = parseXml(modelXml)
  return descendants(root, 'object')
    .filter((objectNode) => elements(objectNode, 'mesh').length > 0)
    .map((objectNode) => ({
      id: objectNode.getAttribute('id') || '',
      name: objectNode.getAttribute('name') || '',
    }))
}

function allocatedIds(modelXml: string): number[] {
  const ids: number[] = []
  const walk = (node: XmlElement) => {
    if (node.nodeType === 1) {
      const raw = node.getAttribute('id')
      if (raw) {
        const id = Number(raw)
        if (Number.isFinite(id)) ids.push(id)
      }
    }
    const nodes = node.childNodes
    for (let index = 0; index < nodes.length; index += 1) {
      const child = nodes[index]
      if (child) walk(child)
    }
  }
  walk(parseXml(modelXml))
  return ids
}

function nextObjectId(modelXml: string): string {
  return String(Math.max(0, ...allocatedIds(modelXml)) + 1)
}

function insertModelMetadata(xml: string, name: string, value: string): string {
  const tag = `<metadata name="${name}">${value}</metadata>`
  const resources = xml.search(/<resources[\s>]/)
  if (resources < 0) return xml
  return `${xml.slice(0, resources)}${tag}${xml.slice(resources)}`
}

function ensureBambuModel(xml: string): string {
  let next = xml.replaceAll(PREVIOUS_APPLICATION, BAMBU_APPLICATION)
  if (!next.includes('BambuStudio-')) {
    next = insertModelMetadata(next, 'Application', BAMBU_APPLICATION)
  }
  if (!next.includes('BambuStudio:3mfVersion')) {
    next = insertModelMetadata(next, 'BambuStudio:3mfVersion', '1')
  }
  return next
}

function standardProjectSettings(nozzle?: string): Record<string, unknown> {
  return presetSettings(nozzle)
}

function isProjectStub(parsed: Record<string, unknown>): boolean {
  const keys = Object.keys(parsed)
  return keys.length > 0 && keys.every((key) => key === 'nozzle_diameter' || key === 'extruder_type') && !parsed.filament_settings_id
}

function repairProjectSettings(files: Record<string, Uint8Array>): void {
  const current = files[PROJECT]
  if (!current) {
    files[PROJECT] = strToU8(JSON.stringify(standardProjectSettings()))
    return
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(strFromU8(current)) as Record<string, unknown>
  } catch {
    return
  }
  if (isProjectStub(parsed)) {
    const nozzle = Array.isArray(parsed.nozzle_diameter) && parsed.nozzle_diameter.length === 1 ? String(parsed.nozzle_diameter[0]) : undefined
    files[PROJECT] = strToU8(JSON.stringify(standardProjectSettings(nozzle)))
    return
  }
  const nozzles = parsed.nozzle_diameter
  if (!Array.isArray(nozzles) || nozzles.length <= 1) return
  const types = Array.isArray(parsed.extruder_type) ? parsed.extruder_type : []
  if (types.length === nozzles.length) return
  const fill = types.length > 0 ? types[types.length - 1] : 'Direct Drive'
  parsed.extruder_type = nozzles.map((_, index) => types[index] ?? fill)
  files[PROJECT] = strToU8(JSON.stringify(parsed))
}

export function nozzleChoice(project: Project3mf): { editable: boolean; value: string; kept: boolean } {
  const raw = project.files[PROJECT]
  if (!raw) return { editable: true, value: '0.4', kept: false }
  try {
    const parsed = JSON.parse(strFromU8(raw)) as Record<string, unknown>
    const nozzles = parsed.nozzle_diameter
    const kept = Object.keys(parsed).some((key) => key !== 'nozzle_diameter' && key !== 'extruder_type')
    if (!Array.isArray(nozzles) || nozzles.length <= 1) {
      const value = Array.isArray(nozzles) && nozzles.length === 1 ? String(nozzles[0]) : '0.4'
      return { editable: true, value, kept }
    }
    return { editable: false, value: nozzles.map(String).join(' / '), kept: true }
  } catch {
    return { editable: false, value: '', kept: true }
  }
}

export function printChoice(project: Project3mf): PrintChoice {
  const raw = project.files[PROJECT]
  if (!raw) return emptyPrintChoice()
  try {
    return choiceFromParsed(JSON.parse(strFromU8(raw)) as Record<string, unknown>)
  } catch {
    return { editable: false, printerId: '', processId: '', filamentId: '', bed: '', filamentCount: 0 }
  }
}

export function setPrintChoice(project: Project3mf, partial: PrintPatch): void {
  const raw = project.files[PROJECT]
  let parsed: Record<string, unknown> = {}
  if (raw) {
    try {
      parsed = JSON.parse(strFromU8(raw)) as Record<string, unknown>
    } catch {
      return
    }
  }
  const next = writeChoice(parsed, partial)
  if (!next) return
  project.files[PROJECT] = strToU8(JSON.stringify(next))
}

export function setNozzleDiameter(project: Project3mf, diameter: string): void {
  const raw = project.files[PROJECT]
  let parsed: Record<string, unknown> = { nozzle_diameter: [diameter], extruder_type: ['Direct Drive'] }
  if (raw) {
    try {
      parsed = JSON.parse(strFromU8(raw)) as Record<string, unknown>
    } catch {
      return
    }
  }
  const nozzles = Array.isArray(parsed.nozzle_diameter) ? parsed.nozzle_diameter : []
  if (nozzles.length > 1) return
  parsed.nozzle_diameter = [diameter]
  if (!Array.isArray(parsed.extruder_type) || parsed.extruder_type.length === 0) {
    parsed.extruder_type = ['Direct Drive']
  }
  project.files[PROJECT] = strToU8(JSON.stringify(parsed))
}

function meshRecord(mesh: { id: string; name: string }, fallbackName: string): ObjectRecord {
  const name = mesh.name || fallbackName
  return {
    id: mesh.id,
    metadata: { name, extruder: '1' },
    parts: [{
      id: mesh.id,
      subtype: 'normal_part',
      metadata: { name, matrix: IDENTITY_MATRIX },
    }],
  }
}

function appendBuildItem(build: XmlElement, objectId: string): void {
  const parsed = parseXml(`<item objectid="${objectId}" printable="1"/>`)
  build.appendChild(first(parsed, 'item') || parsed)
}

function renderPlate(plate: XmlElement, nextIdsFor: (objectId: string) => string[]): string {
  const lines: string[] = []
  const nodes = plate.childNodes
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!node || node.nodeType !== 1) continue
    if (tagName(node) !== 'model_instance') {
      lines.push(`    ${xmlText(node)}`)
      continue
    }
    const objectId = elements(node, 'metadata').find((item) => item.getAttribute('key') === 'object_id')?.getAttribute('value') || ''
    nextIdsFor(objectId).forEach((id) => {
      const metas = elements(node, 'metadata').map((item) => {
        const key = item.getAttribute('key') || ''
        const current = item.getAttribute('value') || ''
        const value = key === 'object_id' || (key === 'identify_id' && current === objectId) ? id : current
        return `      <metadata key="${escapeXml(key)}" value="${escapeXml(value)}"/>`
      })
      lines.push(`    <model_instance>\n${metas.join('\n')}\n    </model_instance>`)
    })
  }
  return `<plate>\n${lines.join('\n')}\n  </plate>`
}

function eachPlate(plateXml: string, nextIdsFor: (objectId: string) => string[]): string {
  const plates = parsePlateNodes(plateXml)
  if (!plates.length) return plateXml
  return plates.map((plate) => renderPlate(plate, nextIdsFor)).join('\n')
}

function expandPlate(plateXml: string, replacements: Map<string, string[]>): string {
  return eachPlate(plateXml, (objectId) => replacements.get(objectId) || [objectId])
}

function assembleItemXml(objectId: string, item: XmlElement): string {
  const transform = item.getAttribute('transform') || IDENTITY_TRANSFORM
  const volumeId = item.getAttribute('volume_id')
  if (volumeId !== null) {
    return `    <assemble_item object_id="${escapeXml(objectId)}" volume_id="${escapeXml(volumeId)}" transform="${escapeXml(transform)}"/>`
  }
  const offset = item.getAttribute('offset') || '0 0 0'
  const instanceId = item.getAttribute('instance_id') || '0'
  return `    <assemble_item object_id="${escapeXml(objectId)}" instance_id="${escapeXml(instanceId)}" transform="${escapeXml(transform)}" offset="${escapeXml(offset)}"/>`
}

function expandAssemble(assembleXml: string, replacements: Map<string, string[]>): string {
  const parsed = parseXml(assembleXml)
  const assemble = tagName(parsed) === 'assemble' ? parsed : descendants(parsed, 'assemble')[0]
  if (!assemble) return assembleXml
  const lines: string[] = []
  elements(assemble, 'assemble_item').forEach((item) => {
    const objectId = item.getAttribute('object_id') || ''
    const nextIds = replacements.get(objectId)
    if (item.getAttribute('volume_id') !== null) {
      if (nextIds && nextIds.length !== 1) return
      lines.push(assembleItemXml(nextIds?.[0] || objectId, item))
      return
    }
    ;(nextIds || [objectId]).forEach((id) => {
      lines.push(assembleItemXml(id, item))
    })
  })
  return `<assemble>\n${lines.join('\n')}\n  </assemble>`
}

function memberGroups(project: Project3mf): Map<string, string> {
  const groups = new Map<string, string>()
  project.members?.forEach((member) => {
    groups.set(member.name, member.path.split('/')[0] || member.path)
  })
  return groups
}

function keptTogether(names: string[], groups: Map<string, string>): boolean {
  if (names.length < 2 || !groups.size) return false
  const keys = [...new Set(names.map((name) => groups.get(name) || ''))]
  return keys.length === 1 && keys[0] !== ''
}

function memberNamesOf(project: Project3mf): Set<string> | null {
  if (!project.members) return null
  return new Set(project.members.map((member) => member.name))
}

function isStickyVolume(part: PartRecord, memberNames: Set<string> | null): boolean {
  if (!VOLUME_SUBTYPES.has(part.subtype)) return false
  const name = part.metadata.name || ''
  if (memberNames?.has(name)) return false
  if (part.subtype === 'modifier_part') return memberNames !== null
  return true
}

function separateAssemblies(project: Project3mf): void {
  const groups = memberGroups(project)
  const memberNames = memberNamesOf(project)
  const raw = project.files[MODEL]
  if (!raw) return
  const root = parseXml(strFromU8(raw))
  const resources = descendants(root, 'resources')[0]
  const build = descendants(root, 'build')[0]
  if (!resources || !build) return
  const resourceObjects = elements(resources, 'object')
  const meshIds = new Set<string>()
  const meshNames = new Map<string, string>()
  resourceObjects.forEach((objectNode) => {
    if (!elements(objectNode, 'mesh').length) return
    const id = objectNode.getAttribute('id') || ''
    if (!id) return
    meshIds.add(id)
    meshNames.set(id, objectNode.getAttribute('name') || '')
  })
  const removed = new Set<string>()
  const members = new Map<string, string[]>()
  const componentTransforms = new Map<string, string>()
  resourceObjects.forEach((objectNode) => {
    if (elements(objectNode, 'mesh').length > 0 || !elements(objectNode, 'components').length) return
    const id = objectNode.getAttribute('id') || ''
    if (!id) return
    const settingsParts = project.objects.find((item) => item.id === id)?.parts || []
    const bodyNames = settingsParts.filter((part) => !isStickyVolume(part, memberNames)).map((part) => part.metadata.name || '')
    if (keptTogether(bodyNames, groups)) return
    const stickyIds = new Set(settingsParts.filter((part) => isStickyVolume(part, memberNames)).map((part) => part.id))
    const memberIds = elements(objectNode, 'components').flatMap((components) => (
      elements(components, 'component').flatMap((component) => {
        const memberId = component.getAttribute('objectid') || ''
        const transform = component.getAttribute('transform')
        if (memberId && transform) componentTransforms.set(memberId, transform)
        return meshIds.has(memberId) && !stickyIds.has(memberId) ? [memberId] : []
      })
    ))
    removed.add(id)
    if (memberIds.length) members.set(id, memberIds)
    resources.removeChild(objectNode)
  })
  if (removed.size) {
    elements(build, 'item').forEach((item) => {
      if (removed.has(item.getAttribute('objectid') || '')) build.removeChild(item)
    })
    const listed = new Set(elements(build, 'item').map((item) => item.getAttribute('objectid') || ''))
    members.forEach((memberIds) => {
      memberIds.forEach((memberId) => {
        if (listed.has(memberId)) return
        listed.add(memberId)
        appendBuildItem(build, memberId)
      })
    })
    project.files[MODEL] = strToU8(xmlText(root))
  }
  const nextObjects: ObjectRecord[] = []
  const seen = new Set<string>()
  const replacements = new Map<string, string[]>()
  project.objects.forEach((objectNode) => {
    const sticky = objectNode.parts.filter((part) => isStickyVolume(part, memberNames))
    const bodies = objectNode.parts.filter((part) => !isStickyVolume(part, memberNames))
    const bodyNames = bodies.map((part) => part.metadata.name || '')
    if (keptTogether(bodyNames, groups)) {
      if (seen.has(objectNode.id)) return
      seen.add(objectNode.id)
      nextObjects.push(objectNode)
      return
    }
    const meshParts = bodies.filter((part) => meshIds.has(part.id))
    const split = meshParts.length > 1 || (meshParts.length === 1 && objectNode.id !== meshParts[0].id)
    if (!split) {
      if (seen.has(objectNode.id)) return
      seen.add(objectNode.id)
      nextObjects.push(objectNode)
      return
    }
    const ids: string[] = []
    meshParts.forEach((part) => {
      if (seen.has(part.id)) return
      seen.add(part.id)
      ids.push(part.id)
      const name = part.metadata.name || meshNames.get(part.id) || part.id
      nextObjects.push({
        id: part.id,
        metadata: { ...objectNode.metadata, name },
        parts: [{ ...part, metadata: { ...part.metadata, name } }],
      })
    })
    if (ids.length === 1) {
      const host = nextObjects.find((item) => item.id === ids[0])
      sticky.forEach((part) => host?.parts.push({ ...part, metadata: { ...part.metadata } }))
    }
    if (ids.length) replacements.set(objectNode.id, ids)
  })
  if (replacements.size) {
    project.objects = nextObjects
    if (project.plateXml) project.plateXml = expandPlate(project.plateXml, replacements)
    if (project.assembleXml) project.assembleXml = expandAssemble(project.assembleXml, replacements)
  }
  attachStickyMeshes(project, componentTransforms)
}

function attachStickyMeshes(project: Project3mf, transforms: Map<string, string>): void {
  const memberNames = memberNamesOf(project)
  const modelXml = project.files[MODEL] ? strFromU8(project.files[MODEL]) : ''
  project.objects.forEach((objectNode) => {
    objectNode.parts.filter((part) => isStickyVolume(part, memberNames) && part.id !== objectNode.id).forEach((part) => {
      if (!meshXmlById(modelXml, part.id)) return
      const assemblyId = ensureAssembly(project, objectNode)
      addComponent(project, assemblyId, part.id, transforms.get(part.id))
    })
  })
}

function meshXmlById(modelXml: string, meshId: string): XmlElement | undefined {
  if (!modelXml) return undefined
  return descendants(parseXml(modelXml), 'object').find((objectNode) => (
    objectNode.getAttribute('id') === meshId && elements(objectNode, 'mesh').length > 0
  ))
}

function clonedMeshById(sourceXml: string, sourceId: string, newId: string): XmlElement | undefined {
  const sourceObject = meshXmlById(sourceXml, sourceId)
  if (!sourceObject) return undefined
  const holder = parseXml(`<resources>${xmlText(sourceObject)}</resources>`)
  const copy = elements(descendants(holder, 'resources')[0] || holder, 'object')[0]
  if (!copy) return undefined
  copy.setAttribute('id', newId)
  return copy
}

function componentTransform(modelXml: string, meshId: string): string | null {
  if (!modelXml) return null
  const component = descendants(parseXml(modelXml), 'component').find((item) => item.getAttribute('objectid') === meshId)
  return component?.getAttribute('transform') || null
}

function copyMeshInto(project: Project3mf, sourceXml: string, sourceId: string): string | null {
  const modelXml = project.files[MODEL] ? strFromU8(project.files[MODEL]) : ''
  const newId = nextObjectId(modelXml)
  const copy = clonedMeshById(sourceXml, sourceId, newId)
  if (!copy) return null
  const root = parseXml(modelXml)
  const resources = descendants(root, 'resources')[0]
  if (!resources) return null
  resources.appendChild(copy)
  saveModel(project, root)
  return newId
}

function isInheritedVolume(part: PartRecord, recipe: Project3mf, fusionNames: Set<string>): boolean {
  const name = part.metadata.name || ''
  if (name && fusionNames.has(name)) return false
  return isStickyVolume(part, memberNamesOf(recipe))
}

function inheritVolumes(project: Project3mf, recipe: Project3mf): void {
  const recipeXml = recipe.files[MODEL] ? strFromU8(recipe.files[MODEL]) : ''
  if (!recipeXml) return
  const fusionNames = new Set(listParts(project).map((row) => row.part.metadata.name || '').filter(Boolean))
  const match = matchDerivedObjects(project.objects, recipe.objects)
  match.forEach((recipeId, derivedId) => {
    const derived = project.objects.find((objectNode) => objectNode.id === derivedId)
    const source = recipe.objects.find((objectNode) => objectNode.id === recipeId)
    if (!derived || !source) return
    const present = new Set(derived.parts.map((part) => part.metadata.name || '').filter(Boolean))
    source.parts.forEach((part) => {
      const name = part.metadata.name || ''
      if (!isInheritedVolume(part, recipe, fusionNames)) return
      if (name && present.has(name)) return
      const meshId = copyMeshInto(project, recipeXml, part.id)
      if (!meshId) return
      const assemblyId = ensureAssembly(project, derived)
      addComponent(project, assemblyId, meshId, componentTransform(recipeXml, part.id))
      derived.parts.push({
        id: meshId,
        subtype: part.subtype,
        metadata: { ...part.metadata },
      })
      if (name) present.add(name)
    })
  })
}

function alivePlateIds(plateXml: string): Set<string> {
  const ids = new Set<string>()
  parsePlateNodes(plateXml).forEach((plate) => {
    const id = plateNumber(plate)
    if (id) ids.add(id)
  })
  return ids
}

function metadataPath(value: string): string | null {
  const trimmed = value.trim().replace(/^\/+/, '')
  if (!trimmed.startsWith('Metadata/')) return null
  if (trimmed.endsWith('.gcode')) return null
  return trimmed
}

function stripPlateGcodeRefs(plateXml: string): string {
  const plates = parsePlateNodes(plateXml)
  if (!plates.length) return plateXml
  return plates.map((plate) => {
    const lines: string[] = []
    const nodes = plate.childNodes
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]
      if (!node || node.nodeType !== 1) continue
      if (tagName(node) === 'metadata') {
        const key = node.getAttribute('key') || ''
        const value = node.getAttribute('value') || ''
        if (key === 'gcode_file' || value.endsWith('.gcode')) continue
      }
      lines.push(`    ${xmlText(node)}`)
    }
    return `<plate>\n${lines.join('\n')}\n  </plate>`
  }).join('\n')
}

function inheritPlateSidecars(project: Project3mf, recipe: Project3mf): void {
  const alive = alivePlateIds(project.plateXml)
  if (!alive.size) return
  project.plateXml = stripPlateGcodeRefs(project.plateXml)
  parsePlateNodes(project.plateXml).forEach((plate) => {
    elements(plate, 'metadata').forEach((item) => {
      const path = metadataPath(item.getAttribute('value') || '')
      const bytes = path ? recipe.files[path] : undefined
      if (path && bytes) project.files[path] = bytes.slice()
    })
  })
  const sequence = recipe.files[FILAMENT_SEQUENCE]
  if (sequence) {
    try {
      const parsed = JSON.parse(strFromU8(sequence)) as Record<string, unknown>
      const next: Record<string, unknown> = {}
      alive.forEach((id) => {
        const key = `plate_${id}`
        if (key in parsed) next[key] = parsed[key]
      })
      if (Object.keys(next).length) project.files[FILAMENT_SEQUENCE] = strToU8(JSON.stringify(next))
    } catch {
      // 耗材顺序不是这份工程能读的格式时，留给写出时的空表。
    }
  }
  const gcode = recipe.files[CUSTOM_GCODE]
  if (!gcode) return
  const xml = strFromU8(gcode)
  const parsed = parseXml(xml)
  const root = descendants(parsed, 'custom_gcodes_per_layer')[0]
  const plates = root ? elements(root, 'plate') : []
  if (!root || !plates.length) {
    project.files[CUSTOM_GCODE] = gcode.slice()
    return
  }
  const kept = plates.filter((plate) => alive.has(first(plate, 'plate_info')?.getAttribute('id') || ''))
  if (!kept.length) return
  project.files[CUSTOM_GCODE] = strToU8(`<?xml version="1.0" encoding="utf-8"?>\n<custom_gcodes_per_layer>\n${kept.map((plate) => xmlText(plate)).join('\n')}\n</custom_gcodes_per_layer>\n`)
}

function objectPartKey(objectNode: ObjectRecord): string {
  return objectNode.parts.map((part) => part.metadata.name || '').filter(Boolean).sort().join('\0')
}

function matchDerivedObjects(derived: ObjectRecord[], recipe: ObjectRecord[]): Map<string, string> {
  const result = new Map<string, string>()
  const used = new Set<string>()
  const claim = (derivedId: string, recipeId: string) => {
    if (!derivedId || !recipeId || result.has(derivedId) || used.has(recipeId)) return
    result.set(derivedId, recipeId)
    used.add(recipeId)
  }
  const byParts = new Map<string, ObjectRecord[]>()
  recipe.forEach((objectNode) => {
    const key = objectPartKey(objectNode)
    if (!key) return
    const list = byParts.get(key) || []
    list.push(objectNode)
    byParts.set(key, list)
  })
  derived.forEach((objectNode) => {
    const hits = (byParts.get(objectPartKey(objectNode)) || []).filter((item) => !used.has(item.id))
    if (hits.length === 1 && hits[0]) claim(objectNode.id, hits[0].id)
  })
  derived.forEach((objectNode) => {
    if (result.has(objectNode.id)) return
    const name = objectNode.metadata.name || ''
    if (!name) return
    const hits = recipe.filter((item) => !used.has(item.id) && item.metadata.name === name)
    if (hits.length === 1 && hits[0]) claim(objectNode.id, hits[0].id)
  })
  derived.forEach((objectNode) => {
    if (result.has(objectNode.id)) return
    const names = new Set(objectNode.parts.map((part) => part.metadata.name || '').filter(Boolean))
    if (!names.size) return
    const hits = recipe.filter((item) => !used.has(item.id) && item.parts.some((part) => names.has(part.metadata.name || '')))
    if (hits.length === 1 && hits[0]) claim(objectNode.id, hits[0].id)
  })
  return result
}

function parkOnFirstPlate(plateXml: string, missing: string[]): string {
  if (!missing.length) return plateXml
  const plates = parsePlateNodes(plateXml)
  if (!plates.length) return plateXml
  const found = plates.findIndex((plate) => plateNumber(plate) === '1')
  if (found < 0) return `${defaultPlate(missing)}\n${plates.map((plate) => xmlText(plate)).join('\n')}`
  const serialized = plates.map((plate) => xmlText(plate))
  serialized[found] = serialized[found].replace('</plate>', `${missing.map((id) => instanceBlock(id)).join('\n')}\n  </plate>`)
  return serialized.join('\n')
}

function inheritedAssemble(objects: ObjectRecord[], recipe: Project3mf, match: Map<string, string>): string {
  const parsed = parseXml(recipe.assembleXml)
  const assemble = tagName(parsed) === 'assemble' ? parsed : descendants(parsed, 'assemble')[0]
  const items = assemble ? elements(assemble, 'assemble_item') : []
  const recipeById = new Map(recipe.objects.map((objectNode) => [objectNode.id, objectNode]))
  const lines: string[] = []
  objects.forEach((objectNode) => {
    const recipeId = match.get(objectNode.id) || ''
    const instances = items.filter((item) => item.getAttribute('object_id') === recipeId && item.getAttribute('volume_id') === null)
    const usable = instances.length ? instances : [null]
    usable.forEach((item) => {
      if (!item) {
        lines.push(`    <assemble_item object_id="${escapeXml(objectNode.id)}" instance_id="0" transform="${IDENTITY_TRANSFORM}" offset="0 0 0"/>`)
        return
      }
      lines.push(assembleItemXml(objectNode.id, item))
    })
    const recipeObject = recipeById.get(recipeId)
    objectNode.parts.forEach((part, index) => {
      const sourceIndex = recipeObject?.parts.findIndex((source) => (source.metadata.name || '') !== '' && source.metadata.name === part.metadata.name) ?? -1
      const volume = sourceIndex >= 0
        ? items.find((item) => item.getAttribute('object_id') === recipeId && item.getAttribute('volume_id') === String(sourceIndex))
        : undefined
      const transform = volume?.getAttribute('transform') || IDENTITY_TRANSFORM
      lines.push(`    <assemble_item object_id="${escapeXml(objectNode.id)}" volume_id="${index}" transform="${escapeXml(transform)}"/>`)
    })
  })
  return `<assemble>\n${lines.join('\n')}\n  </assemble>`
}

function inheritPlacement(project: Project3mf, recipe: Project3mf): void {
  if (!recipe.plateXml && !recipe.assembleXml) return
  const match = matchDerivedObjects(project.objects, recipe.objects)
  const derivedByRecipe = new Map<string, string>()
  match.forEach((recipeId, derivedId) => derivedByRecipe.set(recipeId, derivedId))
  if (recipe.plateXml) {
    const rewritten = eachPlate(recipe.plateXml, (objectId) => {
      const nextId = derivedByRecipe.get(objectId)
      return nextId ? [nextId] : []
    })
    const placed = new Set<string>()
    parsePlateNodes(rewritten).forEach((plate) => {
      elements(plate, 'model_instance').forEach((instance) => {
        const objectId = elements(instance, 'metadata').find((item) => item.getAttribute('key') === 'object_id')?.getAttribute('value') || ''
        if (objectId) placed.add(objectId)
      })
    })
    const missing = project.objects.map((objectNode) => objectNode.id).filter((id) => id && !placed.has(id))
    project.plateXml = parkOnFirstPlate(rewritten, missing)
  }
  if (recipe.assembleXml) project.assembleXml = inheritedAssemble(project.objects, recipe, match)
}

export function derivePackage(
  recipe: Project3mf,
  fusionBytes: Uint8Array,
  documentName: string,
): { project: Project3mf; omitted: string[] } {
  const derived = createFromFusionMesh(fusionBytes, documentName)
  const recipeParts = new Map<string, { objectMeta: MetadataMap; part: PartRecord }>()
  recipe.objects.forEach((objectNode) => {
    objectNode.parts.forEach((part) => {
      const name = part.metadata.name || ''
      if (!name || recipeParts.has(name)) return
      recipeParts.set(name, { objectMeta: objectNode.metadata, part })
    })
  })
  derived.objects.forEach((objectNode) => {
    const part = objectNode.parts[0]
    const source = part ? recipeParts.get(part.metadata.name || '') : undefined
    if (!part || !source) return
    const name = part.metadata.name || ''
    part.subtype = source.part.subtype
    part.metadata = {
      ...source.part.metadata,
      name,
      matrix: source.part.metadata.matrix || IDENTITY_MATRIX,
    }
    objectNode.metadata = { ...objectNode.metadata, ...source.objectMeta, name: objectNode.metadata.name || name }
  })
  if (recipe.files[PROJECT]) derived.files[PROJECT] = recipe.files[PROJECT].slice()
  const fusionNames = new Set(listParts(derived).map((row) => row.part.metadata.name || '').filter(Boolean))
  const allowedNames = recipe.members
    ? recipe.members.map((member) => member.name)
    : listParts(recipe).map((row) => row.part.metadata.name || '').filter(Boolean)
  const allowed = new Set(allowedNames)
  const omitted = allowedNames.filter((name) => !fusionNames.has(name))
  dropPartsNamed(derived, [...fusionNames].filter((name) => !allowed.has(name)))
  if (recipe.members) {
    const present = new Set(listParts(derived).map((row) => row.part.metadata.name || ''))
    derived.members = recipe.members.filter((member) => present.has(member.name)).map((member) => ({ ...member }))
  }
  nestMembers(derived)
  inheritVolumes(derived, recipe)
  derived.variants = recipe.variants.map((variant) => ({ name: variant.name, parameters: { ...variant.parameters } }))
  derived.exportDir = recipe.exportDir
  inheritPlacement(derived, recipe)
  inheritPlateSidecars(derived, recipe)
  return { project: derived, omitted }
}

export function createFromFusionMesh(bytes: Uint8Array, documentName: string): Project3mf {
  const files = unzip(bytes)
  const modelXml = strFromU8(files[MODEL] || strToU8(''))
  const meshes = meshObjects(modelXml)
  const project = {
    files,
    objects: meshes.map((mesh) => meshRecord(mesh, documentName)),
    plateXml: '',
    assembleXml: '',
    variants: [],
    exportDir: DEFAULT_EXPORT_DIR,
    members: null,
  }
  separateAssemblies(project)
  return project
}

function replaceMesh(targetXml: string, partId: string, sourceXml: string, sourceName: string): string {
  const target = parseXml(targetXml)
  const source = parseXml(sourceXml)
  const sourceObject = descendants(source, 'object').find((objectNode) => objectNode.getAttribute('name') === sourceName)
  const sourceMesh = sourceObject ? first(sourceObject, 'mesh') : undefined
  const targetObject = descendants(target, 'object').find((objectNode) => objectNode.getAttribute('id') === partId)
  const targetMesh = targetObject ? first(targetObject, 'mesh') : undefined
  if (!sourceMesh || !targetObject || !targetMesh) return targetXml
  targetObject.removeChild(targetMesh)
  targetObject.appendChild(sourceMesh)
  return xmlText(target)
}

export function mergeFusionMesh(project: Project3mf, fusionBytes: Uint8Array): { project: Project3mf; replaced: string[]; missing: string[]; failed: string[] } {
  const fusionFiles = unzip(fusionBytes)
  const fusionXml = strFromU8(fusionFiles[MODEL] || strToU8(''))
  const byName = new Map(meshObjects(fusionXml).map((objectNode) => [objectNode.name, objectNode.name]))
  let modelXml = strFromU8(project.files[MODEL] || strToU8(''))
  const replaced: string[] = []
  const missing: string[] = []
  const failed: string[] = []
  project.objects.forEach((objectNode) => {
    objectNode.parts.forEach((part) => {
      const name = part.metadata.name || ''
      if (!name || !byName.has(name)) {
        if (name) missing.push(name)
        return
      }
      const next = replaceMesh(modelXml, part.id, fusionXml, name)
      if (next !== modelXml) {
        modelXml = next
        replaced.push(name)
      } else {
        failed.push(name)
      }
    })
  })
  project.files[MODEL] = strToU8(modelXml)
  return { project, replaced, missing, failed }
}

function removeObjectId(root: XmlElement, id: string): void {
  const resources = descendants(root, 'resources')[0]
  if (resources) {
    elements(resources, 'object').forEach((objectNode) => {
      if (objectNode.getAttribute('id') === id && elements(objectNode, 'mesh').length > 0) {
        resources.removeChild(objectNode)
      }
    })
  }
  descendants(root, 'components').forEach((components) => {
    elements(components, 'component').forEach((component) => {
      if (component.getAttribute('objectid') === id) components.removeChild(component)
    })
  })
  const build = descendants(root, 'build')[0]
  if (build) {
    elements(build, 'item').forEach((item) => {
      if (item.getAttribute('objectid') === id) build.removeChild(item)
    })
  }
}

export function dropPartsNamed(project: Project3mf, names: string[]): void {
  const drop = new Set(names)
  const ids: string[] = []
  project.objects.forEach((objectNode) => {
    objectNode.parts = objectNode.parts.filter((part) => {
      if (!drop.has(part.metadata.name || '')) return true
      ids.push(part.id)
      return false
    })
  })
  project.objects = project.objects.filter((objectNode) => objectNode.parts.length > 0)
  if (!ids.length || !project.files[MODEL]) return
  const root = parseXml(strFromU8(project.files[MODEL]))
  ids.forEach((id) => removeObjectId(root, id))
  project.files[MODEL] = strToU8(xmlText(root))
}

export function removePart(project: Project3mf, partId: string): void {
  project.objects.forEach((objectNode) => {
    objectNode.parts = objectNode.parts.filter((part) => part.id !== partId)
  })
  project.objects = project.objects.filter((objectNode) => objectNode.parts.length > 0)
  if (!project.files[MODEL]) return
  const root = parseXml(strFromU8(project.files[MODEL]))
  removeObjectId(root, partId)
  project.files[MODEL] = strToU8(xmlText(root))
}

function clonedMesh(sourceXml: string, sourceName: string, newId: string): XmlElement | undefined {
  const sourceObject = descendants(parseXml(sourceXml), 'object').find((objectNode) => (
    objectNode.getAttribute('name') === sourceName && elements(objectNode, 'mesh').length > 0
  ))
  if (!sourceObject) return undefined
  const holder = parseXml(`<resources>${xmlText(sourceObject)}</resources>`)
  const copy = elements(descendants(holder, 'resources')[0] || holder, 'object')[0]
  if (!copy) return undefined
  copy.setAttribute('id', newId)
  return copy
}

function addBuildItem(root: XmlElement, objectId: string): void {
  const build = descendants(root, 'build')[0]
  if (!build) throw new Error('3dmodel 没有 build')
  const parsed = parseXml(`<item objectid="${objectId}" printable="1"/>`)
  build.appendChild(first(parsed, 'item') || parsed)
}

export function fusionMeshName(path: string): string {
  const last = path.split('/').pop() || path
  return last.replace(/:\d+$/, '')
}

export function includeFusionMesh(project: Project3mf, fusionBytes: Uint8Array, meshName: string): void {
  if (listParts(project).some((row) => row.part.metadata.name === meshName)) {
    throw new Error(`工程里已经有「${meshName}」`)
  }
  const fusionXml = strFromU8(unzip(fusionBytes)[MODEL] || strToU8(''))
  const modelXml = strFromU8(project.files[MODEL] || strToU8(''))
  const newId = nextObjectId(modelXml)
  const copy = clonedMesh(fusionXml, meshName, newId)
  if (!copy) throw new Error(`Fusion 网格里没有「${meshName}」`)
  const root = parseXml(modelXml)
  const resources = descendants(root, 'resources')[0]
  if (!resources) throw new Error('3dmodel 没有 resources')
  resources.appendChild(copy)
  addBuildItem(root, newId)
  project.files[MODEL] = strToU8(xmlText(root))
  project.objects.push(meshRecord({ id: newId, name: meshName }, meshName))
  placeOnPlate(project, newId)
}

function modelRoot(project: Project3mf): XmlElement {
  return parseXml(strFromU8(project.files[MODEL] || strToU8('')))
}

function saveModel(project: Project3mf, root: XmlElement): void {
  project.files[MODEL] = strToU8(xmlText(root))
}

function resourceObjects(root: XmlElement): XmlElement[] {
  const resources = descendants(root, 'resources')[0]
  return resources ? elements(resources, 'object') : []
}

function appendFragment(parent: XmlElement, xml: string, name: string): void {
  const parsed = parseXml(xml)
  parent.appendChild(first(parsed, name) || parsed)
}

function mapPlateObjects(plateXml: string, mapId: (id: string) => string | null): string {
  if (!plateXml) return plateXml
  return eachPlate(plateXml, (objectId) => {
    const nextId = mapId(objectId)
    return nextId === null ? [] : [nextId]
  })
}

function mapAssembleObjects(assembleXml: string, mapId: (id: string) => string | null): string {
  if (!assembleXml) return assembleXml
  const parsed = parseXml(assembleXml)
  const assemble = tagName(parsed) === 'assemble' ? parsed : descendants(parsed, 'assemble')[0]
  if (!assemble) return assembleXml
  const lines: string[] = []
  elements(assemble, 'assemble_item').forEach((item) => {
    const objectId = item.getAttribute('object_id') || ''
    const nextId = mapId(objectId)
    if (nextId === null) return
    lines.push(assembleItemXml(nextId, item))
  })
  return `<assemble>\n${lines.join('\n')}\n  </assemble>`
}

function relocateObject(project: Project3mf, fromId: string, toId: string | null): void {
  if (!fromId || fromId === toId) return
  project.plateXml = mapPlateObjects(project.plateXml, (id) => (id === fromId ? toId : id))
  project.assembleXml = mapAssembleObjects(project.assembleXml, (id) => (id === fromId ? toId : id))
}

function plateNumber(plate: XmlElement): string {
  return elements(plate, 'metadata').find((item) => item.getAttribute('key') === 'plater_id')?.getAttribute('value') || ''
}

function instanceBlock(objectId: string, instanceId = '0'): string {
  return `    <model_instance>
      <metadata key="object_id" value="${escapeXml(objectId)}"/>
      <metadata key="instance_id" value="${escapeXml(instanceId)}"/>
      <metadata key="identify_id" value="${escapeXml(objectId)}"/>
    </model_instance>`
}

function placeOnPlate(project: Project3mf, objectId: string): void {
  if (project.plateXml && !listedOnPlate(project.plateXml, objectId)) {
    const plates = parsePlateNodes(project.plateXml)
    if (plates.length) {
      const found = plates.findIndex((plate) => plateNumber(plate) === '1')
      if (found < 0) {
        project.plateXml = `${defaultPlate([objectId])}\n${plates.map((plate) => xmlText(plate)).join('\n')}`
      } else {
        const serialized = plates.map((plate) => xmlText(plate))
        serialized[found] = serialized[found].replace('</plate>', `${instanceBlock(objectId)}\n  </plate>`)
        project.plateXml = serialized.join('\n')
      }
    }
  }
  if (project.assembleXml && !project.assembleXml.includes(`object_id="${objectId}"`)) {
    const transform = project.assembleXml.match(/transform="([^"]+)"/)?.[1] || IDENTITY_TRANSFORM
    project.assembleXml = project.assembleXml.replace(
      '</assemble>',
      `    <assemble_item object_id="${objectId}" instance_id="0" transform="${transform}" offset="0 0 0"/>\n  </assemble>`,
    )
  }
}

function listedOnPlate(plateXml: string, objectId: string): boolean {
  return parsePlateNodes(plateXml).some((plate) => (
    elements(plate, 'model_instance').some((instance) => (
      elements(instance, 'metadata').some((item) => item.getAttribute('key') === 'object_id' && item.getAttribute('value') === objectId)
    ))
  ))
}

function ensureAssembly(project: Project3mf, parent: ObjectRecord): string {
  const root = modelRoot(project)
  const current = resourceObjects(root).find((objectNode) => objectNode.getAttribute('id') === parent.id)
  if (current && elements(current, 'components').length > 0) return parent.id
  const resources = descendants(root, 'resources')[0]
  const build = descendants(root, 'build')[0]
  if (!resources || !build) return parent.id
  const assemblyId = nextObjectId(xmlText(root))
  const meshId = parent.parts[0]?.id || parent.id
  const name = parent.metadata.name || parent.parts[0]?.metadata.name || ''
  appendFragment(resources, `<object id="${assemblyId}" type="model" name="${escapeXml(name)}"><components><component objectid="${meshId}"/></components></object>`, 'object')
  elements(build, 'item').forEach((item) => {
    if (item.getAttribute('objectid') === parent.id) item.setAttribute('objectid', assemblyId)
  })
  saveModel(project, root)
  relocateObject(project, parent.id, assemblyId)
  parent.id = assemblyId
  return assemblyId
}

function addComponent(project: Project3mf, assemblyId: string, meshId: string, transform?: string | null): void {
  const root = modelRoot(project)
  const assembly = resourceObjects(root).find((objectNode) => objectNode.getAttribute('id') === assemblyId)
  if (!assembly) return
  let components = first(assembly, 'components')
  if (!components) {
    appendFragment(assembly, '<components/>', 'components')
    components = first(assembly, 'components')
  }
  if (!components) return
  const listed = elements(components, 'component').some((component) => component.getAttribute('objectid') === meshId)
  if (!listed) {
    const transformAttr = transform ? ` transform="${escapeXml(transform)}"` : ''
    appendFragment(components, `<component objectid="${meshId}"${transformAttr}/>`, 'component')
  }
  const build = descendants(root, 'build')[0]
  if (build) {
    elements(build, 'item').forEach((item) => {
      if (item.getAttribute('objectid') === meshId) build.removeChild(item)
    })
  }
  saveModel(project, root)
}

function mergeChild(project: Project3mf, parent: ObjectRecord, child: ObjectRecord): void {
  const meshId = child.parts[0]?.id || child.id
  if (parent.parts.some((part) => part.id === meshId)) return
  const assemblyId = ensureAssembly(project, parent)
  addComponent(project, assemblyId, meshId)
  relocateObject(project, child.id, null)
  parent.parts.push(...child.parts.map((part) => ({ ...part, metadata: { ...part.metadata } })))
  project.objects = project.objects.filter((objectNode) => objectNode !== child)
}

export function nestMembers(project: Project3mf): boolean {
  if (!project.members?.length || !project.files[MODEL]) return false
  const groups = new Map<string, { name: string }[]>()
  project.members.forEach((member) => {
    const key = member.path.split('/')[0] || member.path
    const list = groups.get(key) || []
    list.push(member)
    groups.set(key, list)
  })
  let changed = false
  groups.forEach((members, key) => {
    if (members.length < 2) return
    const topName = key.replace(/:\d+$/, '')
    const parent = project.objects.find((objectNode) => objectNode.metadata.name === topName)
      || project.objects.find((objectNode) => objectNode.parts.some((part) => part.metadata.name === topName))
    if (!parent) return
    members.forEach((member) => {
      if (parent.parts.some((part) => part.metadata.name === member.name)) return
      const child = project.objects.find((objectNode) => (
        objectNode !== parent && objectNode.parts.length === 1 && objectNode.parts[0]?.metadata.name === member.name
      ))
      if (!child) return
      mergeChild(project, parent, child)
      changed = true
    })
  })
  return changed
}

export function updatePart(
  project: Project3mf,
  partId: string,
  patch: { subtype?: string; metadata?: MetadataMap; removeKeys?: string[] },
): void {
  project.objects.forEach((objectNode) => {
    objectNode.parts.forEach((part) => {
      if (part.id !== partId) return
      if (patch.subtype) part.subtype = patch.subtype
      if (patch.metadata) part.metadata = { ...part.metadata, ...patch.metadata }
      patch.removeKeys?.forEach((key) => {
        delete part.metadata[key]
      })
    })
  })
}

export function toBytes(project: Project3mf): Uint8Array {
  const files = { ...project.files }
  if (files[MODEL]) files[MODEL] = strToU8(ensureBambuModel(strFromU8(files[MODEL])))
  files[SETTINGS] = strToU8(writeSettings(project))
  const variantFile: { variants: VariantRecord[]; exportDir: string; members?: MemberRecord[] } = {
    variants: project.variants,
    exportDir: normalizeExportDir(project.exportDir),
  }
  if (project.members !== null) variantFile.members = project.members
  files[VARIANTS] = strToU8(JSON.stringify(variantFile, null, 2))
  repairProjectSettings(files)
  ensureBambuSideFiles(files, project)
  ensureContentTypes(files)
  return zipSync(files)
}

function ensureBambuSideFiles(files: Record<string, Uint8Array>, project: Project3mf): void {
  if (!files[SLICE_INFO]) {
    files[SLICE_INFO] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="${BAMBU_APPLICATION.replace('BambuStudio-', '')}"/>
  </header>
</config>
`)
  }
  if (!files[FILAMENT_SEQUENCE]) {
    files[FILAMENT_SEQUENCE] = strToU8(JSON.stringify({ plate_1: { nozzle_sequence: [], optimal_assignment: [], sequence: [] } }))
  }
  if (!files[CUT_INFORMATION]) {
    const ids = project.objects.flatMap((objectNode) => objectNode.parts.map((part) => part.id)).filter(Boolean)
    const body = (ids.length ? ids : ['1']).map((id) => ` <object id="${escapeXml(id)}">
  <cut_id id="0" check_sum="1" connectors_cnt="0"/>
 </object>`).join('\n')
    files[CUT_INFORMATION] = strToU8(`<?xml version="1.0" encoding="utf-8"?>\n<objects>\n${body}\n</objects>\n`)
  }
}

function ensureContentTypes(files: Record<string, Uint8Array>): void {
  const name = '[Content_Types].xml'
  const current = files[name] ? strFromU8(files[name]) : `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="png" ContentType="image/png"/>
</Types>`
  const extras = [
    ['/Metadata/model_settings.config', 'text/xml'],
    ['/Metadata/project_settings.config', 'application/json'],
    ['/Metadata/fusion_batch_variants.json', 'application/json'],
    ['/Metadata/slice_info.config', 'text/xml'],
    ['/Metadata/filament_sequence.json', 'application/json'],
    ['/Metadata/cut_information.xml', 'text/xml'],
    ['/Metadata/custom_gcode_per_layer.xml', 'text/xml'],
  ]
  let next = current
  extras.forEach(([part, type]) => {
    if (!next.includes(part)) {
      next = next.replace('</Types>', `  <Override PartName="${part}" ContentType="${type}"/>\n</Types>`)
    }
  })
  files[name] = strToU8(next)
}

export function listParts(project: Project3mf): { objectId: string; objectName: string; part: PartRecord }[] {
  return project.objects.flatMap((objectNode) => objectNode.parts.map((part) => ({
    objectId: objectNode.id,
    objectName: objectNode.metadata.name || objectNode.id,
    part,
  })))
}

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

const MODEL = '3D/3dmodel.model'
const SETTINGS = 'Metadata/model_settings.config'
const PROJECT = 'Metadata/project_settings.config'
const VARIANTS = 'Metadata/fusion_batch_variants.json'
const IDENTITY_MATRIX = '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1'
const BAMBU_APPLICATION = 'BambuStudio-01.09.07.50'

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

export type Project3mf = {
  files: Record<string, Uint8Array>
  objects: ObjectRecord[]
  plateXml: string
  assembleXml: string
  variants: VariantRecord[]
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
  return {
    files,
    objects: parsed.objects,
    plateXml: parsed.plateXml,
    assembleXml: parsed.assembleXml,
    variants: readVariants(files[VARIANTS]),
  }
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
  const plate = first(config, 'plate')
  const assemble = first(config, 'assemble')
  return {
    objects,
    plateXml: plate ? xmlText(plate) : '',
    assembleXml: assemble ? xmlText(assemble) : '',
  }
}

function readVariants(bytes: Uint8Array | undefined): VariantRecord[] {
  if (!bytes) return []
  const parsed = JSON.parse(strFromU8(bytes)) as { variants?: VariantRecord[] }
  return parsed.variants || []
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

function defaultPlate(objectId: string): string {
  return `<plate>
    <metadata key="plater_id" value="1"/>
    <model_instance>
      <metadata key="object_id" value="${escapeXml(objectId)}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${escapeXml(objectId)}"/>
    </model_instance>
  </plate>`
}

function defaultAssemble(objectId: string): string {
  return `<assemble>
    <assemble_item object_id="${escapeXml(objectId)}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0" offset="0 0 0"/>
  </assemble>`
}

export function writeSettings(project: Project3mf): string {
  const objects = project.objects.map((objectNode) => {
    const parts = objectNode.parts.map((part) => {
      const meta = writeMetadata(part.metadata, '      ')
      return `    <part id="${escapeXml(part.id)}" subtype="${escapeXml(part.subtype)}">
${meta}
    </part>`
    }).join('\n')
    const meta = writeMetadata(objectNode.metadata, '    ')
    return `  <object id="${escapeXml(objectNode.id)}">
${meta}
${parts}
  </object>`
  }).join('\n')
  const objectId = project.objects[0]?.id || '1'
  const plate = project.plateXml || defaultPlate(objectId)
  const assemble = project.assembleXml || defaultAssemble(objectId)
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
  let next = xml
  if (!next.includes('BambuStudio-')) {
    next = insertModelMetadata(next, 'Application', BAMBU_APPLICATION)
  }
  if (!next.includes('BambuStudio:3mfVersion')) {
    next = insertModelMetadata(next, 'BambuStudio:3mfVersion', '1')
  }
  return next
}

function repairProjectSettings(files: Record<string, Uint8Array>): void {
  const current = files[PROJECT]
  if (!current) {
    files[PROJECT] = strToU8(JSON.stringify({
      nozzle_diameter: ['0.4'],
      extruder_type: ['Direct Drive'],
    }))
    return
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(strFromU8(current)) as Record<string, unknown>
  } catch {
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

function groupFusionMeshes(modelXml: string, documentName: string): string {
  const root = parseXml(modelXml)
  const resources = descendants(root, 'resources')[0]
  const build = descendants(root, 'build')[0]
  if (!resources || !build) return modelXml
  if (descendants(root, 'component').length > 0) return modelXml
  const meshes = elements(resources, 'object').filter((objectNode) => elements(objectNode, 'mesh').length > 0)
  if (!meshes.length) return modelXml
  const groupId = nextObjectId(modelXml)
  const components = meshes
    .map((objectNode) => `<component objectid="${objectNode.getAttribute('id')}"/>`)
    .join('')
  const group = parseXml(
    `<object id="${groupId}" type="model" name="${escapeXml(documentName)}"><components>${components}</components></object>`,
  )
  resources.appendChild(first(group, 'object') || group)
  const items = elements(build, 'item')
  items.forEach((item) => build.removeChild(item))
  const item = parseXml(`<item objectid="${groupId}"/>`)
  build.appendChild(first(item, 'item') || item)
  return xmlText(root)
}

export function createFromFusionMesh(bytes: Uint8Array, documentName: string): Project3mf {
  const files = unzip(bytes)
  const modelXml = strFromU8(files[MODEL] || strToU8(''))
  const grouped = groupFusionMeshes(modelXml, documentName)
  files[MODEL] = strToU8(grouped)
  const meshes = meshObjects(grouped).filter((objectNode) => objectNode.name !== documentName)
  const group = descendants(parseXml(grouped), 'object').find((objectNode) => (
    objectNode.getAttribute('name') === documentName && elements(objectNode, 'components').length > 0
  ))
  const objectId = group?.getAttribute('id') || meshes[0]?.id || '1'
  const project: Project3mf = {
    files,
    objects: [{
      id: objectId,
      metadata: { name: documentName, extruder: '1' },
      parts: meshes.map((mesh) => ({
        id: mesh.id,
        subtype: 'normal_part',
        metadata: { name: mesh.name, matrix: IDENTITY_MATRIX },
      })),
    }],
    plateXml: '',
    assembleXml: '',
    variants: [],
  }
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
  if (!ids.length || !project.files[MODEL]) return
  const root = parseXml(strFromU8(project.files[MODEL]))
  ids.forEach((id) => removeObjectId(root, id))
  project.files[MODEL] = strToU8(xmlText(root))
}

export function removePart(project: Project3mf, partId: string): void {
  project.objects.forEach((objectNode) => {
    objectNode.parts = objectNode.parts.filter((part) => part.id !== partId)
  })
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

function addComponentRef(root: XmlElement, parentId: string, childId: string): void {
  const parent = descendants(root, 'object').find((objectNode) => objectNode.getAttribute('id') === parentId)
  if (!parent) return
  const existing = first(parent, 'components')
  const parsed = parseXml(`<component objectid="${childId}"/>`)
  const component = first(parsed, 'component') || parsed
  if (existing) {
    existing.appendChild(component)
    return
  }
  const wrapper = parseXml(`<components></components>`)
  const components = first(wrapper, 'components') || wrapper
  components.appendChild(component)
  parent.appendChild(components)
}

export function includeFusionMesh(project: Project3mf, fusionBytes: Uint8Array, meshName: string): void {
  if (listParts(project).some((row) => row.part.metadata.name === meshName)) return
  const fusionXml = strFromU8(unzip(fusionBytes)[MODEL] || strToU8(''))
  const documentName = project.objects[0]?.metadata.name || '未命名'
  const previousId = project.objects[0]?.id || ''
  let modelXml = groupFusionMeshes(strFromU8(project.files[MODEL] || strToU8('')), documentName)
  const grouped = descendants(parseXml(modelXml), 'object').find((objectNode) => (
    objectNode.getAttribute('name') === documentName && elements(objectNode, 'components').length > 0
  ))
  const groupId = grouped?.getAttribute('id') || previousId
  if (project.objects[0] && groupId && groupId !== previousId) {
    project.objects[0].id = groupId
    project.plateXml = project.plateXml.split(`"${previousId}"`).join(`"${groupId}"`)
    project.assembleXml = project.assembleXml.split(`object_id="${previousId}"`).join(`object_id="${groupId}"`)
  }
  const newId = nextObjectId(modelXml)
  const copy = clonedMesh(fusionXml, meshName, newId)
  if (!copy) throw new Error(`Fusion 网格里没有「${meshName}」`)
  const root = parseXml(modelXml)
  const resources = descendants(root, 'resources')[0]
  if (!resources) throw new Error('3dmodel 没有 resources')
  resources.appendChild(copy)
  addComponentRef(root, project.objects[0]?.id || groupId, newId)
  project.files[MODEL] = strToU8(xmlText(root))
  if (!project.objects.length) {
    project.objects.push({ id: groupId || newId, metadata: { name: documentName }, parts: [] })
  }
  project.objects[0].parts.push({
    id: newId,
    subtype: 'normal_part',
    metadata: { name: meshName, matrix: IDENTITY_MATRIX },
  })
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
  files[VARIANTS] = strToU8(JSON.stringify({ variants: project.variants }, null, 2))
  repairProjectSettings(files)
  ensureContentTypes(files)
  return zipSync(files)
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

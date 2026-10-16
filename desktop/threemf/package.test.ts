import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createFromFusionMesh, dropPartsNamed, includeFusionMesh, mergeFusionMesh, readProject, toBytes, updatePart } from './package'

function model(objects: { id: string; name: string; z: string }[]): string {
  const body = objects.map((objectNode) => `
    <object id="${objectNode.id}" type="model" name="${objectNode.name}">
      <mesh>
        <vertices><vertex x="0" y="0" z="${objectNode.z}"/></vertices>
        <triangles></triangles>
      </mesh>
    </object>`).join('')
  const items = objects.map((objectNode) => `<item objectid="${objectNode.id}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
  <resources>${body}</resources>
  <build>${items}</build>
</model>`
}

function pack(files: Record<string, string>): Uint8Array {
  const encoded: Record<string, Uint8Array> = {}
  Object.keys(files).forEach((name) => {
    encoded[name] = strToU8(files[name])
  })
  return zipSync(encoded)
}

describe('threemf', () => {
  it('groups fusion meshes into one object and escapes names', () => {
    const bytes = pack({
      '3D/3dmodel.model': model([
        { id: '1', name: '盒子', z: '0' },
        { id: '3', name: '盖子 & 顶', z: '9' },
      ]),
      'plate_1.gcode': 'G1',
      'Metadata/slice_info.config': '<config/>',
    })
    const project = createFromFusionMesh(bytes, '干燥盒')
    const saved = toBytes(project)
    const files = unzipSync(saved)
    expect(files['plate_1.gcode']).toBeUndefined()
    expect(files['Metadata/slice_info.config']).toBeUndefined()
    const settings = strFromU8(files['Metadata/model_settings.config'])
    expect(settings).toContain('盖子 &amp; 顶')
    expect(settings).toContain('subtype="normal_part"')
    expect(settings).toContain('1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')
    const modelXml = strFromU8(files['3D/3dmodel.model'])
    expect(modelXml.match(/<item /g)?.length).toBe(1)
    expect(modelXml).toContain('<component ')
    const loaded = readProject(saved)
    expect(loaded.objects[0].parts).toHaveLength(2)
    expect(loaded.assembleXml).toContain('assemble_item')
    expect(modelXml).toContain('BambuStudio-')
    expect(modelXml).toContain('BambuStudio:3mfVersion')
    const projectSettings = JSON.parse(strFromU8(files['Metadata/project_settings.config'])) as {
      nozzle_diameter: string[]
      extruder_type: string[]
    }
    expect(projectSettings.extruder_type).toHaveLength(projectSettings.nozzle_diameter.length)
  })

  it('does not reuse a color group id for the printable object', () => {
    const xml = model([
      { id: '1', name: '盒子', z: '0' },
      { id: '3', name: '盖子', z: '9' },
    ]).replace(
      '<resources>',
      '<resources><m:colorgroup id="4" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"><m:color color="#FFFFFFFF"/></m:colorgroup>',
    )
    const project = createFromFusionMesh(pack({ '3D/3dmodel.model': xml }), '干燥盒')
    expect(project.objects[0].id).toBe('5')
    const modelXml = strFromU8(project.files['3D/3dmodel.model'])
    expect(modelXml.match(/id="4"/g)?.length).toBe(1)
  })

  it('pads extruder_type to the nozzle count and leaves a matching project untouched', () => {
    const created = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([{ id: '1', name: '盒子', z: '0' }]),
    }), '干燥盒')
    const broken = '{"printer_model":"Other","nozzle_diameter":["0.4","0.2"],"extruder_type":["Direct Drive"],"sparse_infill_density":"15%"}'
    created.files['Metadata/project_settings.config'] = strToU8(broken)
    const repaired = JSON.parse(strFromU8(unzipSync(toBytes(created))['Metadata/project_settings.config'])) as {
      extruder_type: string[]
      sparse_infill_density: string
    }
    expect(repaired.extruder_type).toEqual(['Direct Drive', 'Direct Drive'])
    expect(repaired.sparse_infill_density).toBe('15%')

    const sound = '{"nozzle_diameter":["0.4"],"extruder_type":["Direct Drive"]}'
    created.files['Metadata/project_settings.config'] = strToU8(sound)
    expect(strFromU8(unzipSync(toBytes(created))['Metadata/project_settings.config'])).toBe(sound)
  })

  it('replaces a matching mesh and keeps the part id and assemble text', () => {
    const created = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([
        { id: '1', name: '盒子', z: '0' },
        { id: '3', name: '盖子', z: '9' },
      ]),
    }), '干燥盒')
    created.assembleXml = '<assemble><assemble_item object_id="9" transform="9 0 0 0 1 0 0 0 1 3 4 5"/></assemble>'
    created.variants = [{ name: '加长', parameters: { 长: '30 mm' } }]
    updatePart(created, '1', { subtype: 'modifier_part', metadata: { sparse_infill_density: '15%' } })
    const source = toBytes(created)
    const loaded = readProject(source)
    const merged = mergeFusionMesh(loaded, pack({
      '3D/3dmodel.model': model([
        { id: '8', name: '盒子', z: '4' },
        { id: '9', name: '盖子', z: '11' },
      ]),
    }))
    expect(merged.replaced).toContain('盒子')
    const saved = toBytes(merged.project)
    const modelXml = strFromU8(unzipSync(saved)['3D/3dmodel.model'])
    expect(modelXml).toContain('z="4"')
    expect(modelXml).toContain('id="1"')
    const again = readProject(saved)
    expect(again.objects[0].parts.find((part) => part.id === '1')?.subtype).toBe('modifier_part')
    expect(again.objects[0].parts.find((part) => part.id === '1')?.metadata.sparse_infill_density).toBe('15%')
    expect(again.assembleXml).toContain('3 4 5')
    expect(again.variants[0].name).toBe('加长')
  })

  it('includes a new fusion mesh and can omit an orphan from a derived package', () => {
    const created = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([{ id: '1', name: '盒子', z: '0' }]),
    }), '干燥盒')
    includeFusionMesh(created, pack({
      '3D/3dmodel.model': model([
        { id: '4', name: '盒子', z: '0' },
        { id: '5', name: '盖子', z: '2' },
      ]),
    }), '盖子')
    const lid = created.objects[0].parts.find((part) => part.metadata.name === '盖子')
    expect(lid?.subtype).toBe('normal_part')
    expect(lid?.metadata.matrix).toBe('1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')
    expect(lid?.metadata.sparse_infill_density).toBeUndefined()
    const included = strFromU8(created.files['3D/3dmodel.model'])
    expect(included).toContain('name="盖子"')
    expect(included.match(/<item /g)?.length).toBe(1)
    dropPartsNamed(created, ['盖子'])
    const dropped = strFromU8(created.files['3D/3dmodel.model'])
    expect(dropped).not.toContain('name="盖子"')
    expect(created.objects[0].parts.map((part) => part.metadata.name)).toEqual(['盒子'])
  })
})

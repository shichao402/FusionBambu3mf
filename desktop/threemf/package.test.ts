import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createFromFusionMesh, derivePackage, dropPartsNamed, fusionMeshName, includeFusionMesh, membersFromAlignment, mergeFusionMesh, nestMembers, nozzleChoice, printChoice, readProject, relativeExportDir, resolveExportDir, setNozzleDiameter, setPrintChoice, toBytes, updatePart } from './package'
import { printerById } from './presets'

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
  it('keeps each fusion mesh as its own object and escapes names', () => {
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
    expect(strFromU8(files['Metadata/slice_info.config'])).toContain('X-BBL-Client-Version')
    const settings = strFromU8(files['Metadata/model_settings.config'])
    expect(settings).toContain('盖子 &amp; 顶')
    expect(settings).toContain('subtype="normal_part"')
    expect(settings).toContain('mesh_stat')
    expect(settings).toContain('filament_map_mode')
    expect(settings).toContain('volume_id="0"')
    expect(settings).toContain('extruder')
    expect(settings).toContain('1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')
    const modelXml = strFromU8(files['3D/3dmodel.model'])
    expect(modelXml.match(/<item /g)?.length).toBe(2)
    expect(modelXml).not.toContain('<component ')
    const loaded = readProject(saved)
    expect(loaded.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子', '盖子 & 顶'])
    expect(loaded.objects.every((objectNode) => objectNode.parts.length === 1)).toBe(true)
    expect(loaded.assembleXml).toContain('assemble_item')
    expect(modelXml).toContain('BambuStudio-')
    expect(modelXml).toContain('BambuStudio:3mfVersion')
    const projectSettings = JSON.parse(strFromU8(files['Metadata/project_settings.config'])) as {
      nozzle_diameter: string[]
      extruder_type: string[]
      filament_settings_id: string[]
      printer_settings_id: string
      print_settings_id: string
      curr_bed_type: string
    }
    expect(projectSettings.extruder_type).toHaveLength(projectSettings.nozzle_diameter.length)
    expect(projectSettings.filament_settings_id).toEqual(['Bambu PLA Basic @BBL A1'])
    expect(projectSettings.printer_settings_id).toBe('Bambu Lab A1 0.4 nozzle')
    expect(projectSettings.print_settings_id).toBe('0.20mm Standard @BBL A1')
    expect(projectSettings.curr_bed_type).toBe('Textured PEI Plate')
  })

  it('does not wrap fusion meshes into one components object', () => {
    const xml = model([
      { id: '1', name: '盒子', z: '0' },
      { id: '3', name: '盖子', z: '9' },
    ]).replace(
      '<resources>',
      '<resources><m:colorgroup id="4" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"><m:color color="#FFFFFFFF"/></m:colorgroup>',
    )
    const project = createFromFusionMesh(pack({ '3D/3dmodel.model': xml }), '干燥盒')
    expect(project.objects.map((objectNode) => objectNode.id)).toEqual(['1', '3'])
    const saved = strFromU8(unzipSync(toBytes(project))['Metadata/model_settings.config'])
    expect(saved.match(/<object /g)?.length).toBe(2)
    expect(saved.match(/<part /g)?.length).toBe(2)
    expect(saved).not.toContain('<component ')
  })

  it('splits a saved components parent into one plate object per mesh', () => {
    const xml = model([
      { id: '1', name: '盒子', z: '0' },
      { id: '3', name: '盖子', z: '9' },
    ]).replace(
      '</resources>',
      '<object id="4" type="model" name="干燥盒"><components><component objectid="1"/><component objectid="3"/></components></object></resources>',
    ).replace(
      '<build><item objectid="1"/><item objectid="3"/></build>',
      '<build><item objectid="4"/></build>',
    )
    const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="4">
    <metadata key="name" value="干燥盒"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="盒子"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="sparse_infill_density" value="15%"/>
    </part>
    <part id="3" subtype="modifier_part">
      <metadata key="name" value="盖子"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance>
      <metadata key="object_id" value="4"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="4"/>
    </model_instance>
  </plate>
  <assemble>
    <assemble_item object_id="4" instance_id="0" transform="1 0 0 0 1 0 0 0 1 3 4 5" offset="0 0 0"/>
  </assemble>
</config>`
    const project = readProject(pack({
      '3D/3dmodel.model': xml,
      'Metadata/model_settings.config': settings,
    }))
    expect(project.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子', '盖子'])
    expect(project.objects.map((objectNode) => objectNode.id)).toEqual(['1', '3'])
    expect(project.objects[0].metadata.extruder).toBe('1')
    expect(project.objects[0].parts[0].metadata.sparse_infill_density).toBe('15%')
    expect(project.objects[1].parts[0].subtype).toBe('modifier_part')
    expect(project.plateXml.match(/object_id/g)?.length).toBe(2)
    expect(project.assembleXml).toContain('object_id="1"')
    expect(project.assembleXml).toContain('object_id="3"')
    expect(project.assembleXml).toContain('3 4 5')
    const modelXml = strFromU8(project.files['3D/3dmodel.model'])
    expect(modelXml).not.toContain('<component ')
    expect(modelXml.match(/<item /g)?.length).toBe(2)
    const saved = strFromU8(unzipSync(toBytes(project))['Metadata/model_settings.config'])
    expect(saved.match(/<object /g)?.length).toBe(2)
    expect(saved).not.toContain('干燥盒')
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

    const stub = '{"nozzle_diameter":["0.2"],"extruder_type":["Direct Drive"]}'
    created.files['Metadata/project_settings.config'] = strToU8(stub)
    const upgraded = JSON.parse(strFromU8(unzipSync(toBytes(created))['Metadata/project_settings.config'])) as {
      nozzle_diameter: string[]
      filament_settings_id: string[]
      printer_settings_id: string
      print_settings_id: string
    }
    expect(upgraded.nozzle_diameter).toEqual(['0.2'])
    expect(upgraded.printer_settings_id).toBe('Bambu Lab A1 0.2 nozzle')
    expect(upgraded.filament_settings_id).toEqual(['Bambu PLA Basic @BBL A1 0.2 nozzle'])
    expect(upgraded.print_settings_id).toBe('0.10mm Standard @BBL A1 0.2 nozzle')
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
    const lid = created.objects.flatMap((objectNode) => objectNode.parts).find((part) => part.metadata.name === '盖子')
    expect(lid?.subtype).toBe('normal_part')
    expect(lid?.metadata.matrix).toBe('1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')
    expect(lid?.metadata.sparse_infill_density).toBeUndefined()
    const included = strFromU8(created.files['3D/3dmodel.model'])
    expect(included).toContain('name="盖子"')
    expect(included.match(/<item /g)?.length).toBe(2)
    expect(created.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子', '盖子'])
    dropPartsNamed(created, ['盖子'])
    const dropped = strFromU8(created.files['3D/3dmodel.model'])
    expect(dropped).not.toContain('name="盖子"')
    expect(created.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子'])
  })

  it('matches a nested fusion body by its own name', () => {
    expect(fusionMeshName('盒子:1/零部件12:1/实体1')).toBe('实体1')
    expect(fusionMeshName('盒子:1/盒子')).toBe('盒子')
    expect(fusionMeshName('盖子:1')).toBe('盖子')
    const created = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([{ id: '1', name: '盒子', z: '0' }]),
    }), '干燥盒')
    const fusion = pack({
      '3D/3dmodel.model': model([
        { id: '3', name: '盒子', z: '0' },
        { id: '5', name: '实体1', z: '2' },
      ]),
    })
    expect(() => includeFusionMesh(created, fusion, '零部件12')).toThrow('Fusion 网格里没有「零部件12」')
    includeFusionMesh(created, fusion, '实体1')
    expect(created.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子', '实体1'])
  })

  it('puts a nested fusion body under its parent object on the same plate', () => {
    const created = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([
        { id: '5', name: '实体1', z: '2' },
        { id: '1', name: '盒子', z: '0' },
        { id: '3', name: '盖子', z: '9' },
      ]),
    }), '干燥盒')
    created.plateXml = `<plate>
    <model_instance>
      <metadata key="object_id" value="5"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="5"/>
    </model_instance>
    <model_instance>
      <metadata key="object_id" value="1"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
    <model_instance>
      <metadata key="object_id" value="3"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="3"/>
    </model_instance>
  </plate>`
    created.assembleXml = `<assemble>
    <assemble_item object_id="5" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0" offset="0 0 0"/>
    <assemble_item object_id="1" instance_id="0" transform="1 0 0 0 1 0 0 0 1 3 4 5" offset="0 0 0"/>
    <assemble_item object_id="3" instance_id="0" transform="1 0 0 0 1 0 0 0 1 3 4 5" offset="0 0 0"/>
  </assemble>`
    created.members = [
      { path: '盒子:1/盒子', name: '盒子' },
      { path: '盒子:1/零部件12:1/实体1', name: '实体1' },
      { path: '盖子:1/盖子', name: '盖子' },
    ]
    expect(nestMembers(created)).toBe(true)
    const box = created.objects.find((objectNode) => objectNode.metadata.name === '盒子')
    expect(box?.parts.map((part) => part.metadata.name)).toEqual(['盒子', '实体1'])
    expect(created.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子', '盖子'])
    const xml = strFromU8(created.files['3D/3dmodel.model'])
    expect(xml).toContain('<component objectid="5"/>')
    expect(xml).not.toMatch(/<item[^>]*objectid="5"/)
    expect(created.plateXml).toContain(`value="${box?.id}"`)
    expect(created.plateXml).not.toContain('value="5"')
    expect(created.plateXml).toContain('value="3"')
    const again = readProject(toBytes(created))
    expect(again.objects.find((objectNode) => objectNode.metadata.name === '盒子')?.parts.map((part) => part.metadata.name)).toEqual(['盒子', '实体1'])
    expect(again.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子', '盖子'])
  })

  it('derives an export from the recipe members instead of the previous mesh layout', () => {
    const recipe = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([
        { id: '1', name: '盒子', z: '0' },
        { id: '5', name: '实体1', z: '2' },
        { id: '3', name: '盖子', z: '9' },
      ]),
    }), '干燥盒')
    updatePart(recipe, '1', { subtype: 'modifier_part', metadata: { sparse_infill_density: '15%' } })
    recipe.members = [
      { path: '盒子:1/盒子', name: '盒子' },
      { path: '盒子:1/零部件12:1/实体1', name: '实体1' },
    ]
    nestMembers(recipe)
    recipe.files['Metadata/project_settings.config'] = strToU8(JSON.stringify({
      nozzle_diameter: ['0.6'],
      extruder_type: ['Direct Drive'],
      sparse_infill_density: '20%',
    }))
    recipe.variants = [{ name: '加长', parameters: { 长: '30 mm' } }]
    const derived = derivePackage(recipe, pack({
      '3D/3dmodel.model': model([
        { id: '8', name: '盖子', z: '1' },
        { id: '4', name: '盒子', z: '4' },
        { id: '7', name: '实体1', z: '6' },
      ]),
    }), '干燥盒')
    expect(derived.omitted).toEqual([])
    const box = derived.project.objects.find((objectNode) => objectNode.metadata.name === '盒子')
    expect(box?.parts.map((part) => part.metadata.name)).toEqual(['盒子', '实体1'])
    expect(box?.parts.find((part) => part.metadata.name === '盒子')?.metadata.sparse_infill_density).toBe('15%')
    expect(box?.parts.find((part) => part.metadata.name === '盒子')?.subtype).toBe('modifier_part')
    expect(derived.project.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子'])
    const xml = strFromU8(derived.project.files['3D/3dmodel.model'])
    expect(xml).toContain('z="4"')
    expect(xml).toContain('z="6"')
    expect(xml).not.toContain('name="盖子"')
    expect(xml).toContain('<component ')
    const again = readProject(toBytes(derived.project))
    expect(again.objects.find((objectNode) => objectNode.metadata.name === '盒子')?.parts.map((part) => part.metadata.name)).toEqual(['盒子', '实体1'])
    expect(nozzleChoice(again).value).toBe('0.6')
    expect(again.variants[0]?.name).toBe('加长')
    const missing = derivePackage(recipe, pack({
      '3D/3dmodel.model': model([{ id: '4', name: '盒子', z: '4' }]),
    }), '干燥盒')
    expect(missing.omitted).toEqual(['实体1'])
    expect(missing.project.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子'])
    const plain = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([{ id: '1', name: '盒子', z: '0' }]),
    }), '干燥盒')
    updatePart(plain, '1', { metadata: { sparse_infill_density: '12%' } })
    const kept = derivePackage(plain, pack({
      '3D/3dmodel.model': model([
        { id: '2', name: '盒子', z: '3' },
        { id: '3', name: '盖子', z: '8' },
      ]),
    }), '干燥盒')
    expect(kept.omitted).toEqual([])
    expect(kept.project.objects.map((objectNode) => objectNode.metadata.name)).toEqual(['盒子'])
    expect(kept.project.objects[0]?.parts[0]?.metadata.sparse_infill_density).toBe('12%')
    expect(strFromU8(kept.project.files['3D/3dmodel.model'])).toContain('z="3"')
    expect(strFromU8(kept.project.files['3D/3dmodel.model'])).not.toContain('<component ')
  })

  it('stores the nozzle from the app without dropping the rest of the preset', () => {
    const created = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([{ id: '1', name: '盒子', z: '0' }]),
    }), '干燥盒')
    setNozzleDiameter(created, '0.6')
    expect(nozzleChoice(created)).toEqual({ editable: true, value: '0.6', kept: false })
    created.files['Metadata/project_settings.config'] = strToU8(JSON.stringify({
      nozzle_diameter: ['0.4'],
      extruder_type: ['Direct Drive'],
      sparse_infill_density: '15%',
    }))
    setNozzleDiameter(created, '0.2')
    const parsed = JSON.parse(strFromU8(created.files['Metadata/project_settings.config']))
    expect(parsed.nozzle_diameter).toEqual(['0.2'])
    expect(parsed.sparse_infill_density).toBe('15%')
    expect(nozzleChoice(created).kept).toBe(true)
  })

  it('writes a selected system preset and snaps incompatible process or filament', () => {
    const created = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([{ id: '1', name: '盒子', z: '0' }]),
    }), '干燥盒')
    expect(printChoice(created)).toMatchObject({
      editable: true,
      printerId: 'Bambu Lab A1 0.4 nozzle',
      processId: '0.20mm Standard @BBL A1',
      filamentId: 'Bambu PLA Basic @BBL A1',
      bed: 'Textured PEI Plate',
    })
    setPrintChoice(created, { filamentId: 'Generic PLA @BBL A1', bed: 'Cool Plate' })
    const selected = JSON.parse(strFromU8(created.files['Metadata/project_settings.config'])) as {
      filament_settings_id: string[]
      filament_vendor: string[]
      filament_ids: string[]
      curr_bed_type: string
      printer_settings_id: string
    }
    expect(selected.filament_settings_id).toEqual(['Generic PLA @BBL A1'])
    expect(selected.filament_vendor).toEqual(['Generic'])
    expect(selected.filament_ids).toEqual(['GFL99'])
    expect(selected.curr_bed_type).toBe('Cool Plate')
    expect(selected.printer_settings_id).toBe('Bambu Lab A1 0.4 nozzle')

    const carbon = printerById('Bambu Lab X1 Carbon 0.4 nozzle')
    setPrintChoice(created, { printerId: 'Bambu Lab X1 Carbon 0.4 nozzle', processId: '0.20mm Standard @BBL A1' })
    const switched = JSON.parse(strFromU8(created.files['Metadata/project_settings.config'])) as {
      printer_settings_id: string
      print_settings_id: string
      filament_settings_id: string[]
      nozzle_diameter: string[]
    }
    expect(switched.printer_settings_id).toBe('Bambu Lab X1 Carbon 0.4 nozzle')
    expect(switched.print_settings_id).toBe(carbon?.process)
    expect(switched.filament_settings_id).toEqual([carbon?.filament])
    expect(switched.nozzle_diameter).toEqual(['0.4'])

    created.files['Metadata/project_settings.config'] = strToU8(JSON.stringify({
      nozzle_diameter: ['0.4', '0.2'],
      printer_settings_id: 'keep',
    }))
    setPrintChoice(created, { bed: 'Cool Plate' })
    expect(JSON.parse(strFromU8(created.files['Metadata/project_settings.config'])).printer_settings_id).toBe('keep')
    expect(printChoice(created).editable).toBe(false)
  })

  it('stores the export folder as a path relative to the 3mf', () => {
    const created = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([{ id: '1', name: '盒子', z: '0' }]),
    }), '干燥盒')
    expect(created.exportDir).toBe('变体')
    expect(resolveExportDir('D:\\模型\\干燥盒.3mf', created.exportDir)).toBe('D:\\模型\\变体')
    expect(relativeExportDir('D:\\模型\\干燥盒.3mf', 'D:\\模型\\变体\\加长')).toBe('变体/加长')
    expect(relativeExportDir('D:\\模型\\干燥盒.3mf', 'E:\\其他')).toBeNull()
    created.exportDir = '输出/一批'
    const again = readProject(toBytes(created))
    expect(again.exportDir).toBe('输出/一批')
    const absolute = readProject(pack({
      '3D/3dmodel.model': model([{ id: '1', name: '盒子', z: '0' }]),
      'Metadata/fusion_batch_variants.json': JSON.stringify({ variants: [], exportDir: 'C:/绝对路径' }),
    }))
    expect(absolute.exportDir).toBe('变体')
    expect(absolute.members).toBeNull()
  })

  it('records which fusion paths belong in the project', () => {
    const created = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([
        { id: '1', name: '盒子', z: '0' },
        { id: '5', name: '实体1', z: '2' },
      ]),
    }), '干燥盒')
    expect(created.members).toBeNull()
    expect(membersFromAlignment([
      { path: '盒子:1/盒子', keys: ['盒子'] },
      { path: '盒子:1/零部件12:1/实体1', keys: ['实体1', '零部件12'] },
      { path: '盖子:1/盖子', keys: ['盖子'] },
    ], ['盒子', '实体1'])).toEqual([
      { path: '盒子:1/盒子', name: '盒子' },
      { path: '盒子:1/零部件12:1/实体1', name: '实体1' },
    ])
    created.members = [{ path: '盒子:1/盒子', name: '盒子' }]
    const kept = readProject(toBytes(created))
    expect(kept.members).toEqual([{ path: '盒子:1/盒子', name: '盒子' }])
    created.members = []
    const none = readProject(toBytes(created))
    expect(none.members).toEqual([])
  })

  it('keeps every plate when a bambu project is reopened', () => {
    const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="盒子"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="盒子"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    </part>
  </object>
  <object id="3">
    <metadata key="name" value="盖子"/>
    <part id="3" subtype="normal_part">
      <metadata key="name" value="盖子"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="第一盘"/>
    <model_instance>
      <metadata key="object_id" value="3"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="3"/>
    </model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value="第二盘"/>
    <model_instance>
      <metadata key="object_id" value="1"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
  </plate>
  <assemble>
    <assemble_item object_id="3" instance_id="0" transform="1 0 0 0 1 0 0 0 1 10 0 0" offset="0 0 0"/>
    <assemble_item object_id="1" instance_id="0" transform="0 1 0 -1 0 0 0 0 1 3 4 5" offset="0 0 0"/>
  </assemble>
</config>`
    const project = readProject(pack({
      '3D/3dmodel.model': model([
        { id: '1', name: '盒子', z: '0' },
        { id: '3', name: '盖子', z: '9' },
      ]),
      'Metadata/model_settings.config': settings,
    }))
    expect(project.plateXml.match(/<plate\b/g)?.length).toBe(2)
    expect(project.plateXml).toContain('第二盘')
    const saved = strFromU8(unzipSync(toBytes(project))['Metadata/model_settings.config'])
    expect(saved.match(/<plate\b/g)?.length).toBe(2)
    expect(saved).toContain('第二盘')
    expect(saved).toContain('3 4 5')
    const again = readProject(toBytes(project))
    expect(again.plateXml.match(/<plate\b/g)?.length).toBe(2)
    expect(again.assembleXml).toContain('object_id="1"')
    expect(again.assembleXml).toContain('3 4 5')
  })

  it('inherits plate assignment and orientation, and parks an unmatched object on plate 1', () => {
    const recipe = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([
        { id: '1', name: '盒子', z: '0' },
        { id: '5', name: '实体1', z: '2' },
        { id: '3', name: '盖子', z: '9' },
        { id: '7', name: '耳朵', z: '1' },
      ]),
    }), '干燥盒')
    recipe.members = [
      { path: '盒子:1/盒子', name: '盒子' },
      { path: '盒子:1/零部件12:1/实体1', name: '实体1' },
      { path: '盖子:1/盖子', name: '盖子' },
      { path: '耳朵:1/耳朵', name: '耳朵' },
    ]
    nestMembers(recipe)
    const box = recipe.objects.find((objectNode) => objectNode.metadata.name === '盒子')
    const lid = recipe.objects.find((objectNode) => objectNode.metadata.name === '盖子')
    const ear = recipe.objects.find((objectNode) => objectNode.metadata.name === '耳朵')
    const entityIndex = box?.parts.findIndex((part) => part.metadata.name === '实体1') ?? -1
    expect(box?.id).toBeTruthy()
    expect(lid?.id).toBeTruthy()
    expect(ear?.id).toBeTruthy()
    expect(entityIndex).toBe(1)
    recipe.plateXml = `<plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="第一盘"/>
    <model_instance>
      <metadata key="object_id" value="${lid?.id}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${lid?.id}"/>
    </model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value="第二盘"/>
    <metadata key="locked" value="true"/>
    <model_instance>
      <metadata key="object_id" value="${box?.id}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${box?.id}"/>
    </model_instance>
  </plate>`
    recipe.assembleXml = `<assemble>
    <assemble_item object_id="${lid?.id}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 10 0 0" offset="0 0 0"/>
    <assemble_item object_id="${box?.id}" instance_id="0" transform="0 1 0 -1 0 0 0 0 1 3 4 5" offset="0 0 0"/>
    <assemble_item object_id="${box?.id}" volume_id="${entityIndex}" transform="2 0 0 0 2 0 0 0 2 0 0 0"/>
  </assemble>`
    const derived = derivePackage(recipe, pack({
      '3D/3dmodel.model': model([
        { id: '8', name: '盖子', z: '1' },
        { id: '4', name: '盒子', z: '4' },
        { id: '6', name: '耳朵', z: '3' },
        { id: '9', name: '实体1', z: '6' },
      ]),
    }), '干燥盒')
    const nextBox = derived.project.objects.find((objectNode) => objectNode.metadata.name === '盒子')
    const nextLid = derived.project.objects.find((objectNode) => objectNode.metadata.name === '盖子')
    const nextEar = derived.project.objects.find((objectNode) => objectNode.metadata.name === '耳朵')
    const plates = derived.project.plateXml.split(/<plate\b/).slice(1)
    expect(plates).toHaveLength(2)
    expect(plates[0]).toContain(`value="${nextLid?.id}"`)
    expect(plates[0]).toContain(`value="${nextEar?.id}"`)
    expect(plates[0]).not.toContain(`value="${nextBox?.id}"`)
    expect(plates[1]).toContain('第二盘')
    expect(plates[1]).toContain('value="true"')
    expect(plates[1]).toContain(`value="${nextBox?.id}"`)
    expect(plates[1]).not.toContain(`value="${box?.id}"`)
    expect(derived.project.assembleXml).toContain(`object_id="${nextBox?.id}" instance_id="0" transform="0 1 0 -1 0 0 0 0 1 3 4 5"`)
    expect(derived.project.assembleXml).toContain(`object_id="${nextLid?.id}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 10 0 0"`)
    expect(derived.project.assembleXml).toContain(`object_id="${nextBox?.id}" volume_id="1" transform="2 0 0 0 2 0 0 0 2 0 0 0"`)
    expect(derived.project.assembleXml).toContain(`object_id="${nextEar?.id}" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0"`)
    const saved = strFromU8(unzipSync(toBytes(derived.project))['Metadata/model_settings.config'])
    expect(saved.match(/<plate\b/g)?.length).toBe(2)
    expect(saved).toContain('3 4 5')
    expect(saved).toContain('第二盘')
  })

  it('drops plate and orientation when the source has none', () => {
    const recipe = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([{ id: '1', name: '盒子', z: '0' }]),
    }), '干燥盒')
    const derived = derivePackage(recipe, pack({
      '3D/3dmodel.model': model([{ id: '4', name: '盒子', z: '2' }]),
    }), '干燥盒')
    expect(derived.project.plateXml).toBe('')
    expect(derived.project.assembleXml).toBe('')
  })

  it('puts ambiguous objects back on plate 1 with an identity transform', () => {
    const recipe = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([
        { id: '1', name: '盒子', z: '0' },
        { id: '3', name: '盒子', z: '2' },
      ]),
    }), '干燥盒')
    recipe.plateXml = `<plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="第一盘"/>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value="第二盘"/>
    <model_instance>
      <metadata key="object_id" value="1"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
    <model_instance>
      <metadata key="object_id" value="3"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="3"/>
    </model_instance>
  </plate>`
    recipe.assembleXml = `<assemble>
    <assemble_item object_id="1" instance_id="0" transform="1 0 0 0 1 0 0 0 1 3 4 5" offset="0 0 0"/>
    <assemble_item object_id="3" instance_id="0" transform="1 0 0 0 1 0 0 0 1 8 9 1" offset="0 0 0"/>
  </assemble>`
    const derived = derivePackage(recipe, pack({
      '3D/3dmodel.model': model([
        { id: '10', name: '盒子', z: '1' },
        { id: '11', name: '盒子', z: '4' },
      ]),
    }), '干燥盒')
    const plates = derived.project.plateXml.split(/<plate\b/).slice(1)
    expect(plates).toHaveLength(2)
    expect(plates[0]).toContain('value="10"')
    expect(plates[0]).toContain('value="11"')
    expect(plates[1]).not.toContain('object_id')
    expect(derived.project.assembleXml).not.toContain('3 4 5')
    expect(derived.project.assembleXml).not.toContain('8 9 1')
    expect(derived.project.assembleXml).toContain('object_id="10" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0"')
    expect(derived.project.assembleXml).toContain('object_id="11" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0"')
  })

  it('creates plate 1 when an unmatched object has no first plate to fall back to', () => {
    const recipe = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([
        { id: '1', name: '盒子', z: '0' },
        { id: '3', name: '耳朵', z: '1' },
      ]),
    }), '干燥盒')
    recipe.plateXml = `<plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value="第二盘"/>
    <model_instance>
      <metadata key="object_id" value="1"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="1"/>
    </model_instance>
  </plate>`
    recipe.assembleXml = `<assemble>
    <assemble_item object_id="1" instance_id="0" transform="0 1 0 -1 0 0 0 0 1 3 4 5" offset="0 0 0"/>
  </assemble>`
    const derived = derivePackage(recipe, pack({
      '3D/3dmodel.model': model([
        { id: '4', name: '盒子', z: '2' },
        { id: '6', name: '耳朵', z: '3' },
      ]),
    }), '干燥盒')
    const plates = derived.project.plateXml.split(/<plate\b/).slice(1)
    expect(plates).toHaveLength(2)
    expect(plates[0]).toContain('value="1"')
    expect(plates[0]).toContain('value="6"')
    expect(plates[1]).toContain('value="4"')
    expect(plates[1]).toContain('第二盘')
    expect(derived.project.assembleXml).toContain('object_id="4" instance_id="0" transform="0 1 0 -1 0 0 0 0 1 3 4 5"')
    expect(derived.project.assembleXml).toContain('object_id="6" instance_id="0" transform="1 0 0 0 1 0 0 0 1 0 0 0"')
  })

  it('keeps a support volume on its body when the file is reopened', () => {
    const xml = model([
      { id: '1', name: '盒子', z: '0' },
      { id: '3', name: '屏蔽', z: '4' },
    ]).replace(
      '</resources>',
      '<object id="4" type="model" name="盒子"><components><component objectid="1"/><component objectid="3" transform="9 0 0 0 1 0 0 0 1 1 2 3"/></components></object></resources>',
    ).replace('<build><item objectid="1"/><item objectid="3"/></build>', '<build><item objectid="4"/></build>')
    const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="4">
    <metadata key="name" value="盒子"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="盒子"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
    </part>
    <part id="3" subtype="support_blocker">
      <metadata key="name" value="屏蔽"/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 8 9 0 1"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance>
      <metadata key="object_id" value="4"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="4"/>
    </model_instance>
  </plate>
  <assemble>
    <assemble_item object_id="4" instance_id="0" transform="1 0 0 0 1 0 0 0 1 3 4 5" offset="0 0 0"/>
  </assemble>
</config>`
    const project = readProject(pack({
      '3D/3dmodel.model': xml,
      'Metadata/model_settings.config': settings,
    }))
    expect(project.objects).toHaveLength(1)
    expect(project.objects[0]?.parts.map((part) => part.metadata.name)).toEqual(['盒子', '屏蔽'])
    expect(project.objects[0]?.parts[1]?.metadata.matrix).toBe('1 0 0 0 0 1 0 0 0 0 1 0 8 9 0 1')
    const modelXml = strFromU8(project.files['3D/3dmodel.model'])
    expect(modelXml).toContain('objectid="3"')
    expect(modelXml).toContain('transform="9 0 0 0 1 0 0 0 1 1 2 3"')
    expect(modelXml).not.toMatch(/<item[^>]*objectid="3"/)
    expect(project.plateXml).toContain(`value="${project.objects[0]?.id}"`)
    expect(project.assembleXml).toContain('3 4 5')
  })

  it('carries part matrices, bambu volumes, and plate sidecars into the next export', () => {
    const recipe = createFromFusionMesh(pack({
      '3D/3dmodel.model': model([
        { id: '1', name: '盒子', z: '0' },
        { id: '3', name: '盖子', z: '9' },
      ]),
    }), '干燥盒')
    updatePart(recipe, '1', { metadata: { matrix: '2 0 0 0 0 3 0 0 0 0 4 0 1 2 3 1' } })
    const box = recipe.objects.find((objectNode) => objectNode.metadata.name === '盒子')
    const lid = recipe.objects.find((objectNode) => objectNode.metadata.name === '盖子')
    box?.parts.push(
      { id: '40', subtype: 'support_blocker', metadata: { name: '屏蔽', matrix: '1 0 0 0 0 1 0 0 0 0 1 0 8 9 0 1' } },
      { id: '41', subtype: 'negative_part', metadata: { name: '挖空', matrix: '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1' } },
      { id: '43', subtype: 'modifier_part', metadata: { name: '修改器', matrix: '1 0 0 0 0 1 0 0 0 0 1 0 4 0 0 1' } },
    )
    lid?.parts.push({ id: '42', subtype: 'support_enforcer', metadata: { name: '强制', matrix: '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1' } })
    const sourceXml = strFromU8(recipe.files['3D/3dmodel.model'])
    recipe.files['3D/3dmodel.model'] = strToU8(sourceXml.replace(
      '</resources>',
      '<object id="40" type="model" name="屏蔽"><mesh><vertices><vertex x="1" y="2" z="3"/></vertices><triangles></triangles></mesh></object><object id="42" type="model" name="强制"><mesh><vertices><vertex x="4" y="5" z="6"/></vertices><triangles></triangles></mesh></object><object id="43" type="model" name="修改器"><mesh><vertices><vertex x="7" y="0" z="0"/></vertices><triangles></triangles></mesh></object><object id="50" type="model"><components><component objectid="40" transform="9 0 0 0 1 0 0 0 1 1 2 3"/></components></object></resources>',
    ))
    recipe.members = [{ path: '盒子:1/盒子', name: '盒子' }]
    recipe.plateXml = `<plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="第一盘"/>
    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>
    <model_instance>
      <metadata key="object_id" value="${box?.id}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${box?.id}"/>
    </model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value="第二盘"/>
    <metadata key="thumbnail_file" value="Metadata/plate_2.png"/>
    <model_instance>
      <metadata key="object_id" value="${lid?.id}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${lid?.id}"/>
    </model_instance>
  </plate>`
    recipe.assembleXml = `<assemble>
    <assemble_item object_id="${box?.id}" instance_id="0" transform="0 1 0 -1 0 0 0 0 1 3 4 5" offset="0 0 0"/>
    <assemble_item object_id="${box?.id}" volume_id="1" transform="2 0 0 0 2 0 0 0 2 0 0 0"/>
  </assemble>`
    recipe.files['Metadata/plate_1.png'] = strToU8('png-1')
    recipe.files['Metadata/plate_2.png'] = strToU8('png-2')
    recipe.files['Metadata/plate_1.gcode'] = strToU8('G1')
    recipe.files['Metadata/filament_sequence.json'] = strToU8(JSON.stringify({
      plate_1: { sequence: [1] },
      plate_2: { sequence: [2] },
      plate_3: { sequence: [3] },
    }))
    recipe.files['Metadata/custom_gcode_per_layer.xml'] = strToU8(`<?xml version="1.0" encoding="utf-8"?>
<custom_gcodes_per_layer>
  <plate><plate_info id="1"/><layer top_z="0.2" type="2" extra="" gcode="G1 X1"/></plate>
  <plate><plate_info id="2"/><layer top_z="0.2" type="2" extra="" gcode="G1 X2"/></plate>
  <plate><plate_info id="3"/><layer top_z="0.2" type="2" extra="" gcode="G1 X3"/></plate>
</custom_gcodes_per_layer>`)
    const derived = derivePackage(recipe, pack({
      '3D/3dmodel.model': model([{ id: '8', name: '盒子', z: '4' }]),
    }), '干燥盒')
    const nextBox = derived.project.objects.find((objectNode) => objectNode.metadata.name === '盒子')
    expect(nextBox?.parts.find((part) => part.metadata.name === '盒子')?.metadata.matrix).toBe('2 0 0 0 0 3 0 0 0 0 4 0 1 2 3 1')
    expect(nextBox?.parts.map((part) => part.metadata.name)).toEqual(['盒子', '屏蔽', '修改器'])
    expect(nextBox?.parts.find((part) => part.metadata.name === '屏蔽')?.subtype).toBe('support_blocker')
    expect(nextBox?.parts.find((part) => part.metadata.name === '屏蔽')?.metadata.matrix).toBe('1 0 0 0 0 1 0 0 0 0 1 0 8 9 0 1')
    expect(derived.project.objects.some((objectNode) => objectNode.parts.some((part) => part.metadata.name === '强制'))).toBe(false)
    expect(derived.project.objects.some((objectNode) => objectNode.parts.some((part) => part.metadata.name === '挖空'))).toBe(false)
    const modelXml = strFromU8(derived.project.files['3D/3dmodel.model'])
    expect(modelXml).toContain('x="1"')
    expect(modelXml).toContain('x="7"')
    expect(modelXml).not.toContain('x="4" y="5"')
    expect(modelXml).toContain('transform="9 0 0 0 1 0 0 0 1 1 2 3"')
    expect(derived.project.plateXml).not.toContain('.gcode')
    expect(derived.project.files['Metadata/plate_1.gcode']).toBeUndefined()
    expect(strFromU8(derived.project.files['Metadata/plate_1.png'])).toBe('png-1')
    expect(strFromU8(derived.project.files['Metadata/plate_2.png'])).toBe('png-2')
    const sequence = JSON.parse(strFromU8(derived.project.files['Metadata/filament_sequence.json'])) as Record<string, { sequence: number[] }>
    expect(sequence.plate_1?.sequence).toEqual([1])
    expect(sequence.plate_2?.sequence).toEqual([2])
    expect(sequence.plate_3).toBeUndefined()
    const gcode = strFromU8(derived.project.files['Metadata/custom_gcode_per_layer.xml'])
    expect(gcode).toContain('id="1"')
    expect(gcode).toContain('id="2"')
    expect(gcode).not.toContain('id="3"')
    expect(derived.project.assembleXml).toContain(`object_id="${nextBox?.id}" instance_id="0" transform="0 1 0 -1 0 0 0 0 1 3 4 5"`)
    const saved = unzipSync(toBytes(derived.project))
    expect(saved['Metadata/plate_1.gcode']).toBeUndefined()
    expect(saved['Metadata/plate_1.png']).toBeTruthy()
    expect(strFromU8(saved['Metadata/custom_gcode_per_layer.xml'])).not.toContain('id="3"')
  })
})

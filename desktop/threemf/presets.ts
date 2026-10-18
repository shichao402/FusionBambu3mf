import catalog from './bambu-presets.json'

export type PrinterPreset = {
  id: string
  model: string
  nozzle: string
  process: string
  filament: string
  bed: string
  extruder: string
}

export type FilamentPreset = {
  id: string
  type: string
  vendor: string
  filamentId: string
  printers: number[]
}

type ProcessPreset = {
  id: string
  printers: number[]
}

type Catalog = {
  source: string
  beds: string[]
  printers: PrinterPreset[]
  processes: ProcessPreset[]
  filaments: FilamentPreset[]
}

const data = catalog as Catalog
const DEFAULT_PRINTER_ID = 'Bambu Lab A1 0.4 nozzle'

export const PRESET_SOURCE = data.source
export const BED_TYPES = data.beds
export const PRINTERS = data.printers

export type PrintChoice = {
  editable: boolean
  printerId: string
  processId: string
  filamentId: string
  bed: string
  filamentCount: number
}

export type PrintPatch = {
  printerId?: string
  processId?: string
  filamentId?: string
  bed?: string
}

export function printerById(id: string): PrinterPreset | undefined {
  return data.printers.find((printer) => printer.id === id)
}

export function filamentById(id: string): FilamentPreset | undefined {
  return data.filaments.find((filament) => filament.id === id)
}

export function printerForNozzle(nozzle?: string): PrinterPreset {
  const fallback = printerById(DEFAULT_PRINTER_ID) ?? data.printers[0]
  if (!nozzle) return fallback
  return data.printers.find((printer) => printer.model === fallback.model && printer.nozzle === nozzle)
    ?? data.printers.find((printer) => printer.nozzle === nozzle)
    ?? fallback
}

function printerIndex(id: string): number {
  return data.printers.findIndex((printer) => printer.id === id)
}

export function processesFor(printerId: string): string[] {
  const index = printerIndex(printerId)
  if (index < 0) return []
  return data.processes.filter((process) => process.printers.includes(index)).map((process) => process.id)
}

export function filamentsFor(printerId: string): FilamentPreset[] {
  const index = printerIndex(printerId)
  if (index < 0) return []
  return data.filaments.filter((filament) => filament.printers.includes(index))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

export function choiceFromParsed(parsed: Record<string, unknown>): PrintChoice {
  const nozzles = stringArray(parsed.nozzle_diameter)
  const filaments = stringArray(parsed.filament_settings_id)
  const recordedPrinter = typeof parsed.printer_settings_id === 'string' ? parsed.printer_settings_id : ''
  const recordedProcess = typeof parsed.print_settings_id === 'string' ? parsed.print_settings_id : ''
  const recordedBed = typeof parsed.curr_bed_type === 'string' ? parsed.curr_bed_type : ''
  if (nozzles.length > 1) {
    return {
      editable: false,
      printerId: recordedPrinter,
      processId: recordedProcess,
      filamentId: filaments[0] || '',
      bed: recordedBed,
      filamentCount: filaments.length,
    }
  }
  const known = recordedPrinter ? printerById(recordedPrinter) : undefined
  const printer = known ?? (recordedPrinter ? undefined : printerForNozzle(nozzles[0]))
  if (!printer) {
    return {
      editable: true,
      printerId: recordedPrinter,
      processId: recordedProcess,
      filamentId: filaments[0] || '',
      bed: recordedBed,
      filamentCount: Math.max(filaments.length, 1),
    }
  }
  return {
    editable: true,
    printerId: printer.id,
    processId: recordedProcess || printer.process,
    filamentId: filaments[0] || printer.filament,
    bed: recordedBed || printer.bed,
    filamentCount: Math.max(filaments.length, 1),
  }
}

export function emptyPrintChoice(): PrintChoice {
  const printer = printerForNozzle()
  return {
    editable: true,
    printerId: printer.id,
    processId: printer.process,
    filamentId: printer.filament,
    bed: printer.bed,
    filamentCount: 1,
  }
}

export function resolveChoice(base: PrintChoice, partial: PrintPatch): PrintChoice {
  const printerId = partial.printerId ?? base.printerId
  const printer = printerById(printerId)
  if (!printer) {
    return {
      ...base,
      printerId,
      processId: partial.processId ?? base.processId,
      filamentId: partial.filamentId ?? base.filamentId,
      bed: partial.bed ?? base.bed,
      editable: true,
      filamentCount: 1,
    }
  }
  const printerChanged = printer.id !== base.printerId
  const processes = new Set(processesFor(printer.id))
  let processId = partial.processId ?? (printerChanged ? printer.process : base.processId)
  if (!processes.has(processId)) processId = processes.has(printer.process) ? printer.process : [...processes][0] || processId
  const filamentIds = new Set(filamentsFor(printer.id).map((filament) => filament.id))
  let filamentId = partial.filamentId ?? (printerChanged ? printer.filament : base.filamentId)
  if (!filamentIds.has(filamentId)) filamentId = filamentIds.has(printer.filament) ? printer.filament : [...filamentIds][0] || filamentId
  const bed = partial.bed ?? ((printerChanged ? printer.bed : base.bed) || printer.bed)
  return { editable: true, printerId: printer.id, processId, filamentId, bed, filamentCount: 1 }
}

export function settingsForChoice(choice: PrintChoice): Record<string, unknown> {
  const printer = printerById(choice.printerId)
  const filament = filamentById(choice.filamentId)
  const settings: Record<string, unknown> = {
    printer_settings_id: printer?.id ?? choice.printerId,
    print_settings_id: choice.processId,
    filament_settings_id: [choice.filamentId],
    curr_bed_type: choice.bed,
  }
  if (printer) {
    settings.printer_model = printer.model
    settings.nozzle_diameter = [printer.nozzle]
    settings.extruder_type = [printer.extruder]
    settings.default_filament_profile = [printer.filament]
  }
  if (filament) {
    settings.filament_type = [filament.type]
    settings.filament_vendor = [filament.vendor]
    if (filament.filamentId) settings.filament_ids = [filament.filamentId]
  }
  return settings
}

export function presetSettings(nozzle?: string): Record<string, unknown> {
  const printer = printerForNozzle(nozzle)
  return settingsForChoice({
    editable: true,
    printerId: printer.id,
    processId: printer.process,
    filamentId: printer.filament,
    bed: printer.bed,
    filamentCount: 1,
  })
}

export function writeChoice(parsed: Record<string, unknown>, partial: PrintPatch): Record<string, unknown> | null {
  const base = choiceFromParsed(parsed)
  if (!base.editable) return null
  const choice = resolveChoice(base, partial)
  if (!printerById(choice.printerId)) {
    return {
      ...parsed,
      printer_settings_id: choice.printerId,
      print_settings_id: choice.processId,
      filament_settings_id: [choice.filamentId],
      curr_bed_type: choice.bed,
    }
  }
  return settingsForChoice(choice)
}

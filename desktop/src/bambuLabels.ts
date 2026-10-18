export const PART_TYPES = [
  { value: 'normal_part', label: '零件' },
  { value: 'modifier_part', label: '修改器' },
  { value: 'negative_part', label: '负零件' },
  { value: 'support_enforcer', label: '支撑生成器' },
  { value: 'support_blocker', label: '支撑屏蔽' },
]

export const INFILL_PATTERNS = [
  { value: 'grid', label: '网格' },
  { value: 'gyroid', label: '螺旋体' },
  { value: 'honeycomb', label: '蜂窝' },
  { value: '3dhoneycomb', label: '3D 蜂窝' },
  { value: 'rectilinear', label: '直线' },
  { value: 'alignedrectilinear', label: '直线排列' },
  { value: 'triangles', label: '三角形' },
  { value: 'cubic', label: '立方体' },
  { value: 'adaptivecubic', label: '自适应立方体' },
  { value: 'supportcubic', label: '支撑立方体' },
  { value: 'concentric', label: '同心' },
  { value: 'line', label: '线' },
  { value: 'lightning', label: '闪电' },
]

export function subtypeLabel(value: string): string {
  return PART_TYPES.find((item) => item.value === value)?.label || value
}

export function patternLabel(value: string): string {
  return INFILL_PATTERNS.find((item) => item.value === value)?.label || value
}

export function patternOptions(current?: string): { value: string; label: string }[] {
  if (current && !INFILL_PATTERNS.some((item) => item.value === current)) {
    return [...INFILL_PATTERNS, { value: current, label: current }]
  }
  return INFILL_PATTERNS
}

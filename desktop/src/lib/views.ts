export type View = 'overview' | 'parts' | 'variants' | 'export' | 'link'

export const VIEW_CRUMBS: Record<View, string[]> = {
  overview: ['概览'],
  parts: ['概览', '零件'],
  variants: ['概览', '变体'],
  export: ['概览', '导出'],
  link: ['连接'],
}

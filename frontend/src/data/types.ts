/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 字段定档记录：某一字段当前值是哪个班组、哪位值班人定下来的，移交不改写历史。 */
export type FieldHistory = {
  field: string
  value: string
  team: string
  operator: string
  at: string
}

/** 责任移交记录：派班也算第 0 次移交，之后每次换班组追加一条，最后一条为准。 */
export type HandoverRecord = {
  seq: number
  kind: '派班' | '移交'
  at: string
  operator: string
  fromTeam: string
  toTeam: string
  fromDistrict: string
  toDistrict: string
  reason: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | FieldHistory[] | HandoverRecord[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

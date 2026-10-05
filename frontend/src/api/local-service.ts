import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  STEWARD_TEAM_FIELD,
  STATION_VERSION_FIELD,
  TEAM_NAMES,
  attributionFor,
  ensureStationShape,
  lastTransfer,
  listTransfers,
  postOf,
  recordAttribution,
  recordTransfer,
  teamOf,
} from '@/data/stewardship'
import type { FieldAttribution, TransferRecord } from '@/data/stewardship'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const PUMPSTATION_KEY = 'pumpstation'
const DISPATCHPLAN_KEY = 'dispatchplan'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function stationVersion(row: EntryRow): number {
  return Number(row[STATION_VERSION_FIELD] ?? 1)
}

// 泵站动作（投运/检修/停用）也算改档案：只有管护班组能动手，未派班组的站先派班组。
function guardStationAction(row: EntryRow, action: string, operator: string): ActionResult | null {
  const team = String(row[STEWARD_TEAM_FIELD] ?? '')
  if (!team) {
    return { ok: false, message: `「${action}」被退回：该站还没派管护班组，先在待派班组清单里完成责任移交` }
  }
  if (teamOf(operator) !== team) {
    return {
      ok: false,
      message: `「${action}」被退回：该站由「${team}」管护，「${operator || '当前值班人'}」所在的${postOf(operator)}只能查阅、改不动`,
    }
  }
  return null
}

// 一座站停用办结，该片区的调度方案就要重编：同片区站名命中的在审/已批方案退回待编制。
function recallDistrictPlans(district: string): number {
  if (!district) {
    return 0
  }
  const stationNames = listRows(PUMPSTATION_KEY)
    .filter((row) => String(row['所属片区'] ?? '') === district)
    .map((row) => String(row['站名'] ?? ''))
    .filter((name) => name !== '')
  const plans = listRows(DISPATCHPLAN_KEY)
  let touched = 0
  const next = plans.map((plan) => {
    if (plan.status !== '待审核' && plan.status !== '已批准') {
      return plan
    }
    const involves = String(plan['涉及泵站'] ?? '')
    if (!stationNames.some((name) => involves.includes(name))) {
      return plan
    }
    touched += 1
    return { ...plan, status: '待编制', pending: true }
  })
  if (touched > 0) {
    saveRows(DISPATCHPLAN_KEY, next)
  }
  return touched
}

export function runAction(key: string, id: number, action: string, operator = ''): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  if (key === PUMPSTATION_KEY) {
    ensureStationShape()
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (key === PUMPSTATION_KEY) {
    const rejected = guardStationAction(rows[index], action, operator)
    if (rejected) {
      return rejected
    }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === PUMPSTATION_KEY) {
    updated[STATION_VERSION_FIELD] = stationVersion(rows[index]) + 1
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  let message = `${meta.entity}已${action}，当前状态「${target}」`
  if (key === PUMPSTATION_KEY && target === '已停用') {
    const district = String(updated['所属片区'] ?? '')
    const recalled = recallDistrictPlans(district)
    message += recalled > 0
      ? `；该站停用办结，「${district}」有 ${recalled} 个调度方案已退回待编制，需按最新台账重编`
      : `；该站停用办结，「${district}」没有在审或已批准的调度方案需要重编`
  }
  return { ok: true, message }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ---- 泵站管护责任：派班组、查档案、改档案、留痕 ----

/** 正常档案：只放已派管护班组的站；没派班组的站单独挑出来。 */
export function listStations(filters: Record<string, string> = {}): PageResult {
  ensureStationShape()
  const assigned = listRows(PUMPSTATION_KEY).filter(
    (row) => String(row[STEWARD_TEAM_FIELD] ?? '') !== '',
  )
  const matched = filterRows(assigned, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 一直没派班组的站：派完班组就回到正常档案。 */
export function listUnassignedStations(): EntryRow[] {
  ensureStationShape()
  return listRows(PUMPSTATION_KEY).filter(
    (row) => String(row[STEWARD_TEAM_FIELD] ?? '') === '',
  )
}

/** 责任移交：给站派班组，或把站从一个班组移交给另一个班组。 */
export function assignStationTeam(id: number, team: string, operator: string): ActionResult {
  ensureStationShape()
  if (!TEAM_NAMES.includes(team)) {
    return { ok: false, message: `没有名为「${team}」的班组，责任移交作罢` }
  }
  const rows = listRows(PUMPSTATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的排水泵站` }
  }
  const row = rows[index]
  const fromTeam = String(row[STEWARD_TEAM_FIELD] ?? '')
  if (fromTeam === team) {
    return { ok: false, message: `「${row['站名']}」已经由「${team}」管护，不用重复移交` }
  }
  const next = [...rows]
  next[index] = {
    ...row,
    [STEWARD_TEAM_FIELD]: team,
    [STATION_VERSION_FIELD]: stationVersion(row) + 1,
  }
  saveRows(PUMPSTATION_KEY, next)
  recordTransfer({
    stationId: id,
    stationName: String(row['站名'] ?? ''),
    fromTeam: fromTeam || '（未派班组）',
    toTeam: team,
    operator,
  })
  if (!fromTeam) {
    return { ok: true, message: `已给「${row['站名']}」派上「${team}」，该站回到正常档案` }
  }
  return {
    ok: true,
    message: `「${row['站名']}」的管护责任已由「${fromTeam}」移交给「${team}」，此前定稿的数据仍记在原班组名下`,
  }
}

export type StationEditResult = ActionResult & {
  /** 被退回时，点名哪些字段不该由提交人改。 */
  rejectedFields?: string[]
}

/**
 * 改泵站档案：只有管护班组能改；提交带打开时的版本号，
 * 两人并发改同一处时只接受先到的那一版，后到的退回。
 */
export function updateStation(
  id: number,
  changes: Record<string, string>,
  expectedVersion: number,
  operator: string,
): StationEditResult {
  ensureStationShape()
  const rows = listRows(PUMPSTATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的排水泵站` }
  }
  const row = rows[index]
  if (STEWARD_TEAM_FIELD in changes && String(row[STEWARD_TEAM_FIELD] ?? '') !== changes[STEWARD_TEAM_FIELD].trim()) {
    return {
      ok: false,
      rejectedFields: [STEWARD_TEAM_FIELD],
      message: `提交被退回：「${STEWARD_TEAM_FIELD}」不能随档案编辑改，只能走责任移交`,
    }
  }
  const changed = Object.entries(changes).filter(
    ([field, value]) => String(row[field] ?? '') !== value.trim(),
  )
  if (changed.length === 0) {
    return { ok: false, message: '没有改动，不用提交' }
  }
  const team = String(row[STEWARD_TEAM_FIELD] ?? '')
  if (!team) {
    return {
      ok: false,
      rejectedFields: changed.map(([field]) => field),
      message: '提交被退回：该站还没派管护班组，先在待派班组清单里完成责任移交再改档案',
    }
  }
  if (teamOf(operator) !== team) {
    const fields = changed.map(([field]) => field)
    return {
      ok: false,
      rejectedFields: fields,
      message: `提交被退回：${fields.map((field) => `「${field}」`).join('、')}不归「${operator || '当前值班人'}」改——该站管护班组是「${team}」，你所在的${postOf(operator)}只能查阅、改不动`,
    }
  }
  const currentVersion = stationVersion(row)
  if (expectedVersion !== currentVersion) {
    return {
      ok: false,
      message: `提交被退回：你打开档案时是 v${expectedVersion}，已有先到的一版入档（当前 v${currentVersion}），同一处改动只接受先到的那一版，请刷新后重改`,
    }
  }
  const next = [...rows]
  const updated: EntryRow = { ...row, [STATION_VERSION_FIELD]: currentVersion + 1 }
  for (const [field, value] of changed) {
    updated[field] = value.trim()
  }
  next[index] = updated
  saveRows(PUMPSTATION_KEY, next)
  recordAttribution(id, changed.map(([field]) => field), team, operator)
  return {
    ok: true,
    message: `「${updated['站名']}」档案已保存（v${currentVersion + 1}），本次改动 ${changed.length} 项：${changed.map(([field]) => field).join('、')}`,
  }
}

/** 字段留痕：每项数据是哪个班组、哪个人、什么时候定稿的；班组换人不改旧账。 */
export function stationAttribution(id: number): Record<string, FieldAttribution> {
  return attributionFor(id)
}

export function stationTransfers(id?: number): TransferRecord[] {
  return listTransfers(id)
}

/**
 * 在运站数的唯一口径：泵站档案和运营概览都从这里取，
 * 以最后一次责任移交后的档案状态为准。
 */
export function activeStationCount(): { count: number; basis: string } {
  const count = listRows(PUMPSTATION_KEY).filter((row) => String(row.status) === '运行中').length
  const last = lastTransfer()
  const basis = last
    ? `${last.at}「${last.stationName}」移交${last.toTeam}`
    : '尚无责任移交记录'
  return { count, basis }
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const active = activeStationCount()
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '在运泵站', value: active.count },
  ]
  return { cards, modules, stationBasis: active.basis }
}

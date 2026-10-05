import { listRows, saveRows } from '@/data/local-store'
import {
  PLAN_STATUS_ABOLISHED,
  PLAN_STATUS_REBUILD,
  STATION_CREW_FIELDS,
  STATION_RESTRICTED_FIELDS,
  STATION_STATUS_RETIRED,
  STATION_STATUS_RUNNING,
  UNASSIGNED_TEAM,
  VERSION_CONFLICT_PREFIX,
  findOperator,
} from '@/data/pump-domain'
import type { ActionResult, EntryRow, FieldHistory, HandoverRecord } from '@/data/types'

// 泵站管护责任服务：派班、责任移交、字段级权限、乐观锁并发控制、停用级联全部在这里收口，
// 页面只负责渲染和收集输入，不做业务判断。

const MODULE_KEY = 'pumpstation'

export type StationPatch = {
  id: number
  /** 打开档案时取到的版本号，提交时必须仍等于当前版本，否则说明已被别人先改过 */
  baseVersion: number
  operator: string
  changes: Record<string, string>
}

export type AssignPayload = {
  id: number
  baseVersion: number
  operator: string
  toTeam: string
  toDistrict?: string
  reason: string
}

export type HandoverPayload = {
  id: number
  baseVersion: number
  operator: string
  toTeam: string
  toDistrict: string
  reason: string
}

export type StationActionPayload = {
  id: number
  baseVersion: number
  operator: string
  action: string
}

const ACTION_TARGETS: Record<string, string> = {
  提交投运: '运行中',
  安排检修: '检修中',
  停用泵站: '已停用',
}

export function nowStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function getStation(id: number): EntryRow | undefined {
  return listRows(MODULE_KEY).find((row) => Number(row.id) === id)
}

export function isUnassigned(row: EntryRow): boolean {
  return !row['管护班组'] || String(row['管护班组']) === UNASSIGNED_TEAM
}

export function stationVersion(row: EntryRow): number {
  return Number(row['版本'] ?? 1)
}

export function fieldHistory(row: EntryRow): FieldHistory[] {
  return (row['字段定档'] as FieldHistory[] | undefined) ?? []
}

export function handoversOf(row: EntryRow): HandoverRecord[] {
  return (row['移交记录'] as HandoverRecord[] | undefined) ?? []
}

/** 字段定档台账：每一项当前值算在哪个班组头上（换人后历史不改写）。 */
export function ownershipLedger(row: EntryRow): { field: string; value: string; team: string; operator: string; at: string }[] {
  const ledger = new Map<string, FieldHistory>()
  for (const item of fieldHistory(row)) {
    ledger.set(item.field, item)
  }
  return [...ledger.values()].map((item) => ({ ...item }))
}

function persist(next: EntryRow[]): void {
  saveRows(MODULE_KEY, next)
}

function changedFields(row: EntryRow, changes: Record<string, string>): string[] {
  return Object.keys(changes).filter((field) => String(row[field] ?? '') !== String(changes[field] ?? '').trim())
}

/**
 * 保存档案改动。班组之外的人打开只能查阅；硬提交在这里逐字段退回，
 * 返回信息会明确指出「哪一项不该由他改、该谁改」。
 */
export function saveStationEdit(payload: StationPatch): ActionResult {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id0(payload))
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${payload.id} 的排水泵站` }
  }
  const row = rows[index]
  const currentVersion = stationVersion(row)

  // 乐观锁：两位值班人并发改同一处，只接受先到的一版
  if (payload.baseVersion !== currentVersion) {
    const newer = changedSince(row, payload.baseVersion)
    const detail = newer.length ? `；对方先改了：${newer.join('、')}` : ''
    return {
      ok: false,
      message: `${VERSION_CONFLICT_PREFIX}：你打开的是第${payload.baseVersion}版，档案已被先到的提交更新到第${currentVersion}版${detail}，请取最新版后再改`,
    }
  }

  const operator = findOperator(payload.operator)
  const changes = Object.fromEntries(
    Object.entries(payload.changes).map(([field, value]) => [field, String(value ?? '').trim()]),
  )
  const touched = changedFields(row, changes)
  if (touched.length === 0) {
    return { ok: false, message: '没有检测到改动，无需提交' }
  }

  // 没派班组的站不允许在档案里直接改：先去待派队列派班
  if (isUnassigned(row)) {
    return {
      ok: false,
      message: `「${row['站名']}」尚未派定管护班组，档案处于封存状态，须先由调度员派班，派完再回正常档案办理`,
    }
  }

  const restricted = touched.filter((field) => (STATION_RESTRICTED_FIELDS as readonly string[]).includes(field))
  const business = touched.filter((field) => (STATION_CREW_FIELDS as readonly string[]).includes(field))
  const unknown = touched.filter(
    (field) =>
      !(STATION_RESTRICTED_FIELDS as readonly string[]).includes(field) &&
      !(STATION_CREW_FIELDS as readonly string[]).includes(field),
  )

  if (operator.kind === 'dispatcher') {
    const items = [...business, ...unknown]
    if (restricted.length > 0 || items.length > 0) {
      return {
        ok: false,
        message:
          `调度员只能查阅档案，不办理字段修订。` +
          (items.length
            ? `「${items.join('、')}」应由当前管护班组「${row['管护班组']}」修订，不该由调度员改；`
            : '') +
          (restricted.length
            ? `「${restricted.join('、')}」须走「责任移交」而不是直接改档案。`
            : ''),
      }
    }
  }

  if (operator.kind === 'crew') {
    if (operator.team !== String(row['管护班组'])) {
      return {
        ok: false,
        message:
          `「${row['站名']}」的管护班组是「${row['管护班组']}」，` +
          `你所在的「${operator.team || '未编入班组'}」只能查阅，改不动；` +
          `本次退回的改动项：${[...business, ...restricted, ...unknown].join('、')}`,
      }
    }
    if (restricted.length > 0) {
      return {
        ok: false,
        message:
          `以下项不该由管护班组直接改：「${restricted.join('、')}」属于责任划分，` +
          `须报调度员办理责任移交；本次提交已整单退回，其余改动也未保存。`,
      }
    }
    if (unknown.length > 0) {
      return { ok: false, message: `「${unknown.join('、')}」不是本站可登记字段，提交已退回` }
    }
  }

  const updated = applyFieldChanges(row, changes, business, operator.name, operator.team, currentVersion)
  const next = [...rows]
  next[index] = updated
  persist(next)
  return {
    ok: true,
    message: `「${updated['站名']}」档案已更新（第${currentVersion + 1}版），本次由「${operator.team}」定档：${business.join('、')}`,
  }
}

function applyFieldChanges(
  row: EntryRow,
  changes: Record<string, string>,
  fields: string[],
  operatorName: string,
  team: string,
  currentVersion: number,
): EntryRow {
  const incoming = (row['字段定档'] as FieldHistory[] | undefined) ?? []
  const at = nowStamp()
  const stamped = new Map(incoming.map((item) => [item.field, item]))
  for (const field of fields) {
    stamped.set(field, { field, value: changes[field], team, operator: operatorName, at })
  }
  const merged: EntryRow = { ...row, 版本: currentVersion + 1 }
  for (const field of fields) {
    merged[field] = changes[field]
  }
  merged['字段定档'] = [...stamped.values()]
  merged['最后修改'] = `${operatorName}（${team}）${at}`
  return merged
}

/** 调度员给从未派班的站派班组：派完即从待派队列回到正常档案。 */
export function assignStation(payload: AssignPayload): ActionResult {
  const operator = findOperator(payload.operator)
  if (operator.kind !== 'dispatcher') {
    return { ok: false, message: '派定管护班组是调度员职责，班组值班人只能查阅待派名单' }
  }
  const toTeam = String(payload.toTeam ?? '').trim()
  if (!toTeam) {
    return { ok: false, message: '请选择管护班组后再派班' }
  }
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === payload.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${payload.id} 的排水泵站` }
  }
  const row = rows[index]
  const currentVersion = stationVersion(row)
  if (payload.baseVersion !== currentVersion) {
    return { ok: false, message: versionMessage(payload.baseVersion, currentVersion, row) }
  }
  if (!isUnassigned(row)) {
    return { ok: false, message: `「${row['站名']}」已由「${row['管护班组']}」管护，换班组请走责任移交` }
  }

  const at = nowStamp()
  const toDistrict = String(payload.toDistrict ?? row['所属片区'] ?? '').trim() || '未划分片区'
  const previous = handoversOf(row)
  const record: HandoverRecord = {
    seq: previous.length ? previous[previous.length - 1].seq + 1 : 0,
    kind: '派班',
    at,
    operator: operator.name,
    fromTeam: UNASSIGNED_TEAM,
    toTeam,
    fromDistrict: String(row['所属片区'] ?? ''),
    toDistrict,
    reason: String(payload.reason ?? '').trim() || '首次派定管护班组',
  }
  const ledger = repointRestricted(row, toTeam, toDistrict, operator.name, at)
  const updated: EntryRow = {
    ...row,
    管护班组: toTeam,
    所属片区: toDistrict,
    版本: currentVersion + 1,
    字段定档: ledger,
    移交记录: [...previous, record],
    最后修改: `${operator.name} 派班至「${toTeam}」${at}`,
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return { ok: true, message: `「${updated['站名']}」已派给「${toTeam}」管护，回到正常档案（第${currentVersion + 1}版）` }
}

/** 责任移交：换班组/划片区只能走这里；以最后一次移交为准。 */
export function handoverStation(payload: HandoverPayload): ActionResult {
  const operator = findOperator(payload.operator)
  if (operator.kind !== 'dispatcher') {
    return { ok: false, message: '责任移交须由调度员办理，班组之间不得自行划转泵站' }
  }
  const toTeam = String(payload.toTeam ?? '').trim()
  const toDistrict = String(payload.toDistrict ?? '').trim()
  if (!toTeam || !toDistrict) {
    return { ok: false, message: '移交必须选定接收班组与划入片区' }
  }
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === payload.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${payload.id} 的排水泵站` }
  }
  const row = rows[index]
  const currentVersion = stationVersion(row)
  if (payload.baseVersion !== currentVersion) {
    return { ok: false, message: versionMessage(payload.baseVersion, currentVersion, row) }
  }
  if (isUnassigned(row)) {
    return { ok: false, message: `「${row['站名']}」还没派过班组，请先在待派队列办理派班` }
  }
  const fromTeam = String(row['管护班组'])
  const fromDistrict = String(row['所属片区'])
  if (toTeam === fromTeam && toDistrict === fromDistrict) {
    return { ok: false, message: '接收班组与划入片区都没变，不构成责任移交' }
  }

  const at = nowStamp()
  const previous = handoversOf(row)
  const record: HandoverRecord = {
    seq: previous.length ? previous[previous.length - 1].seq + 1 : 1,
    kind: '移交',
    at,
    operator: operator.name,
    fromTeam,
    toTeam,
    fromDistrict,
    toDistrict,
    reason: String(payload.reason ?? '').trim() || '片区重划，调整管护责任',
  }
  const ledger = repointRestricted(row, toTeam, toDistrict, operator.name, at)
  const updated: EntryRow = {
    ...row,
    管护班组: toTeam,
    所属片区: toDistrict,
    版本: currentVersion + 1,
    字段定档: ledger,
    移交记录: [...previous, record],
    最后修改: `${operator.name} 办理移交：${fromTeam}→${toTeam}（${at}）`,
  }
  const next = [...rows]
  next[index] = updated
  persist(next)
  return {
    ok: true,
    message:
      `责任移交办结：「${updated['站名']}」由「${fromTeam}」移交「${toTeam}」（第${currentVersion + 1}版）。` +
      `移交前定档的数据仍记在原班组名下，之后的改动才记「${toTeam}」。`,
  }
}

function repointRestricted(
  row: EntryRow,
  toTeam: string,
  toDistrict: string,
  operatorName: string,
  at: string,
): FieldHistory[] {
  const stamped = new Map(fieldHistory(row).map((item) => [item.field, item]))
  for (const field of STATION_RESTRICTED_FIELDS as readonly string[]) {
    stamped.set(field, {
      field,
      value: field === '管护班组' ? toTeam : toDistrict,
      team: toTeam,
      operator: operatorName,
      at,
    })
  }
  return [...stamped.values()]
}

/** 档案动作（投运/检修/停用）：停用办结会级联该片区调度方案重编。 */
export function runStationAction(payload: StationActionPayload): ActionResult {
  const target = ACTION_TARGETS[payload.action]
  if (!target) {
    return { ok: false, message: `排水泵站没有登记「${payload.action}」这个动作` }
  }
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((row) => Number(row.id) === payload.id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${payload.id} 的排水泵站` }
  }
  const row = rows[index]
  const currentVersion = stationVersion(row)
  if (payload.baseVersion !== currentVersion) {
    return { ok: false, message: versionMessage(payload.baseVersion, currentVersion, row) }
  }
  if (String(row.status) === target) {
    return { ok: false, message: `「${row['站名']}」已经是「${target}」，不用重复操作` }
  }
  if (String(row.status) === STATION_STATUS_RETIRED) {
    return { ok: false, message: `「${row['站名']}」已停用办结，不能再办理运行动作` }
  }

  const operator = findOperator(payload.operator)
  if (isUnassigned(row)) {
    return { ok: false, message: `「${row['站名']}」尚未派班组，须先派班再办理「${payload.action}」` }
  }
  if (operator.kind === 'dispatcher' && payload.action !== '停用泵站') {
    return { ok: false, message: `「${payload.action}」由管护班组「${row['管护班组']}」办理，调度员只可督办停用办结` }
  }
  if (operator.kind === 'crew' && operator.team !== String(row['管护班组'])) {
    return {
      ok: false,
      message: `「${row['站名']}」归「${row['管护班组']}」管护，「${operator.team}」无权办理「${payload.action}」`,
    }
  }

  const at = nowStamp()
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== STATION_STATUS_RETIRED,
    abnormal: target === STATION_STATUS_RETIRED,
    版本: currentVersion + 1,
    最后动作: `${operator.name} ${payload.action} ${at}`,
  }
  const next = [...rows]
  next[index] = updated
  persist(next)

  if (target === STATION_STATUS_RETIRED) {
    const affected = markPlansForRebuild(String(row['所属片区']), String(row['站名']), operator.name)
    const tail = affected.length
      ? `；该片区 ${affected.length} 份调度方案已退回「待重编」：${affected.join('、')}`
      : '；该片区当前没有需要重编的在执行方案'
    return { ok: true, message: `「${row['站名']}」已停用办结（第${currentVersion + 1}版），在运站数同步核减${tail}` }
  }
  return { ok: true, message: `「${updated['站名']}」已${payload.action}，当前状态「${target}」（第${currentVersion + 1}版）` }
}

// 一座站停用办结，该片区的调度方案就要重编：已废止/已在重编的不动，其余全部退回「待重编」。
function markPlansForRebuild(district: string, stationName: string, operatorName: string): string[] {
  const plans = listRows('dispatchplan')
  const affected: string[] = []
  const at = nowStamp()
  const next = plans.map((plan) => {
    const sameDistrict = String(plan['所属片区'] ?? '') === district
    const status = String(plan.status)
    if (!sameDistrict || status === PLAN_STATUS_REBUILD || status === PLAN_STATUS_ABOLISHED) {
      return plan
    }
    affected.push(String(plan['方案名称']))
    return {
      ...plan,
      status: PLAN_STATUS_REBUILD,
      pending: true,
      abnormal: true,
      重编原因: `${stationName}停用办结（${operatorName} ${at}），片区工况变化须重编`,
    }
  })
  if (affected.length > 0) {
    saveRows('dispatchplan', next)
  }
  return affected
}

/** 在运站数：全站唯一口径，泵站档案页与运行概览都取这个数。 */
export function runningStationCount(): number {
  return listRows(MODULE_KEY).filter((row) => String(row.status) === STATION_STATUS_RUNNING).length
}

/** 待派班组队列：一直没派班组的站单独挑出来。 */
export function unassignedStations(): EntryRow[] {
  return listRows(MODULE_KEY).filter(isUnassigned)
}

function changedSince(row: EntryRow, _baseVersion: number): string[] {
  // 版本落后时，把最近一次落版动过的字段提示给后提交的人
  const ledgers = fieldHistory(row).filter((item) => item.at).slice(-3)
  return ledgers.map((item) => item.field)
}

function versionMessage(baseVersion: number, currentVersion: number, row: EntryRow): string {
  return `${VERSION_CONFLICT_PREFIX}：你持有的是第${baseVersion}版，「${row['站名']}」已被先到的提交更新到第${currentVersion}版，请重新打开档案取最新版`
}

function id0(payload: StationPatch): number {
  return payload.id
}

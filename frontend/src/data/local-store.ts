import { SEED_ROWS } from './seed'
import { PLAN_STATUS_REBUILD, STATION_STATUS_RUNNING } from './pump-domain'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'drainage-pump:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 旧版本浏览器里只有示例行，没有管护班组/版本号/片区字段：整库回播种，保证责任规则可用。
function isLegacy(data: Record<string, EntryRow[]>): boolean {
  const station = data.pumpstation?.[0]
  if (station && (station['管护班组'] === undefined || station['版本'] === undefined)) {
    return true
  }
  const plan = data.dispatchplan?.[0]
  if (plan && plan['所属片区'] === undefined) {
    return true
  }
  return false
}

function writeSeed() {
  const fallback = clone(SEED_ROWS)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
  }
  return fallback
}

function readStorage(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(SEED_ROWS)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return writeSeed()
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    if (isLegacy(parsed)) {
      return writeSeed()
    }
    return { ...clone(SEED_ROWS), ...parsed }
  } catch {
    return writeSeed()
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function saveAll(rows: Record<string, EntryRow[]>): void {
  cache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 清回播种数据：测试脚本与页面「重置演示数据」入口共用。 */
export function resetAllRows(): Record<string, EntryRow[]> {
  const seeded = clone(SEED_ROWS)
  saveAll(seeded)
  return seeded
}

// 另一个标签页（另一位值班人）写入后，本标签页必须立刻看到最新版本，
// 否则乐观锁挡不住「两人各改各的旧拷贝」。storage 事件只在其他标签页触发。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
  })
}

/** 在运站数的唯一口径：档案中状态为「运行中」的站数，所有页面都从这里取数。 */
export function countRunningStations(rows: EntryRow[] = listRows('pumpstation')): number {
  return rows.filter((row) => String(row.status) === STATION_STATUS_RUNNING).length
}

/** 待重编方案数，停用办结级联产生，概览与方案页共用口径。 */
export function countRebuildPlans(rows: EntryRow[] = listRows('dispatchplan')): number {
  return rows.filter((row) => String(row.status) === PLAN_STATUS_REBUILD).length
}

export function storageKey(): string {
  return STORAGE_KEY
}

import { listRows, saveRows } from './local-store'

// 泵站管护责任数据层：班组名册、责任移交记录、字段级留痕。
// 与 entries 分开存，清掉 entries 重置台账时留痕也跟着清（见 README 的重置约定）。

export const STEWARD_TEAM_FIELD = '管护班组'
export const STATION_VERSION_FIELD = '版本'

export const TEAM_ROSTER: { team: string; members: string[] }[] = [
  { team: '东湖班组', members: ['陈一泵', '齐二泵'] },
  { team: '西湖班组', members: ['吴三泵', '郑四泵'] },
  { team: '南湖班组', members: ['王五泵', '赵六泵'] },
  { team: '北湖班组', members: ['孙七泵', '钱八泵'] },
]

export const TEAM_NAMES: string[] = TEAM_ROSTER.map((item) => item.team)

// 值班表：调度值班室（值班管理员）不在任何班组，只能查阅和办理责任移交。
export const DUTY_OPERATORS: string[] = [
  '值班管理员',
  ...TEAM_ROSTER.flatMap((item) => item.members),
]

export function teamOf(operator: string): string {
  for (const item of TEAM_ROSTER) {
    if (item.members.includes(operator)) {
      return item.team
    }
  }
  return ''
}

export function postOf(operator: string): string {
  return teamOf(operator) || '调度值班室'
}

export type TransferRecord = {
  stationId: number
  stationName: string
  fromTeam: string
  toTeam: string
  operator: string
  at: string
}

export type FieldAttribution = {
  team: string
  operator: string
  at: string
}

type StewardshipData = {
  transfers: TransferRecord[]
  attribution: Record<string, Record<string, FieldAttribution>>
}

const STORAGE_KEY = 'drainage-pump:stewardship'
const EMPTY: StewardshipData = { transfers: [], attribution: {} }

function readStorage(): StewardshipData {
  if (typeof window === 'undefined' || !window.localStorage) {
    return JSON.parse(JSON.stringify(EMPTY)) as StewardshipData
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return JSON.parse(JSON.stringify(EMPTY)) as StewardshipData
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StewardshipData>
    return {
      transfers: Array.isArray(parsed.transfers) ? parsed.transfers : [],
      attribution: parsed.attribution ?? {},
    }
  } catch {
    return JSON.parse(JSON.stringify(EMPTY)) as StewardshipData
  }
}

let cache: StewardshipData | null = null

function data(): StewardshipData {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data()))
  }
}

function now(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function listTransfers(stationId?: number): TransferRecord[] {
  const all = data().transfers
  if (stationId === undefined) {
    return all
  }
  return all.filter((item) => item.stationId === stationId)
}

export function lastTransfer(): TransferRecord | null {
  const all = data().transfers
  return all.length > 0 ? all[all.length - 1] : null
}

export function recordTransfer(record: Omit<TransferRecord, 'at'>): void {
  data().transfers.push({ ...record, at: now() })
  persist()
}

export function attributionFor(stationId: number): Record<string, FieldAttribution> {
  return data().attribution[String(stationId)] ?? {}
}

// 字段留痕只增不改：班组换人后，之前定稿的数据仍记在原班组名下。
export function recordAttribution(
  stationId: number,
  fields: string[],
  team: string,
  operator: string,
): void {
  const key = String(stationId)
  const bucket = data().attribution[key] ?? {}
  const at = now()
  for (const field of fields) {
    bucket[field] = { team, operator, at }
  }
  data().attribution[key] = bucket
  persist()
}

// 旧版本浏览器缓存里的泵站行没有「管护班组 / 版本」，读出来先补齐再落库。
export function ensureStationShape(): void {
  const rows = listRows('pumpstation')
  let dirty = false
  const next = rows.map((row) => {
    let fixed = row
    if (typeof fixed[STATION_VERSION_FIELD] !== 'number') {
      fixed = { ...fixed, [STATION_VERSION_FIELD]: 1 }
      dirty = true
    }
    if (typeof fixed[STEWARD_TEAM_FIELD] !== 'string') {
      fixed = { ...fixed, [STEWARD_TEAM_FIELD]: '' }
      dirty = true
    }
    return fixed
  })
  if (dirty) {
    saveRows('pumpstation', next)
  }
}

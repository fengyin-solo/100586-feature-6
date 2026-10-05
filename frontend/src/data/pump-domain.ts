/** 泵站管护责任领域常量：班组、值班人、字段权限边界都集中在这里。 */

export type OperatorKind = 'dispatcher' | 'crew'

export type Operator = {
  /** 登录身份名，同时就是值班人姓名 */
  name: string
  kind: OperatorKind
  /** 班组值班人有所属班组，调度员没有 */
  team: string
}

/** 可以选来登录的值班身份。调度员管派班/移交/停用办结，班组只管本站档案。 */
export const OPERATORS: Operator[] = [
  { name: '王调度', kind: 'dispatcher', team: '' },
  { name: '李向东', kind: 'crew', team: '城东泵站班' },
  { name: '赵海生', kind: 'crew', team: '城南泵站班' },
  { name: '孙立秋', kind: 'crew', team: '城西泵站班' },
  { name: '周小川', kind: 'crew', team: '城北泵站班' },
]

/** 派班/移交下拉用：当前在册的管护班组 */
export const CREW_TEAMS = ['城东泵站班', '城南泵站班', '城西泵站班', '城北泵站班']

/** 站点字段里允许责任班组自行修订的业务字段。 */
export const STATION_CREW_FIELDS = [
  '站名',
  '设计流量',
  '装机台数',
  '服务面积',
  '投运日期',
  '站长',
  '站点状态',
] as const

/**
 * 受限字段：只允许通过调度员的派班/责任移交动作变更。
 * - 所属片区：泵站在片区间划来划去，须走责任移交
 * - 管护班组：谁负责这座站，须走责任移交
 */
export const STATION_RESTRICTED_FIELDS = ['所属片区', '管护班组'] as const

export const STATION_STATUS_RUNNING = '运行中'
export const STATION_STATUS_RETIRED = '已停用'

export const PLAN_STATUS_REBUILD = '待重编'
export const PLAN_STATUS_ABOLISHED = '已废止'

/** 乐观锁冲突时的固定提示前缀，页面可据此提供「重新取版」按钮。 */
export const VERSION_CONFLICT_PREFIX = '版本已过期'

/** 没派班组的占位显示 */
export const UNASSIGNED_TEAM = '尚未派班组'

export function findOperator(name: string): Operator {
  const found = OPERATORS.find((item) => item.name === name)
  return found ?? { name, kind: 'crew', team: '' }
}

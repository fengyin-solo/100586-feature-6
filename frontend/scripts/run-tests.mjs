// 领域规则测试：node ./scripts/test-entry.mjs
// 不依赖浏览器；每个用例开头 resetAllRows() 回到播种状态，用例之间互不污染。

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

const pump = await import('../src/api/pump-service.ts')
const store = await import('../src/data/local-store.ts')
const { resetAllRows } = store

function station(id) {
  return store.listRows('pumpstation').find((row) => Number(row.id) === id)
}
function version(id) {
  return pump.stationVersion(station(id))
}

console.log('规则1：每座站有管护班组；班组之外只读、硬提交逐字段退回')
{
  resetAllRows()
  check('示例站带管护班组', String(station(1)['管护班组']) === '城东泵站班')
  // 城南班赵海生改城东一号站的设计流量 —— 退回
  const denied = pump.saveStationEdit({
    id: 1,
    baseVersion: version(1),
    operator: '赵海生',
    changes: { 设计流量: '9.9m³/s' },
  })
  check('外班组硬提交被退回', denied.ok === false)
  check('退回信息点出不该改的字段', denied.message.includes('设计流量'))
  check('退回信息说明责任班组', denied.message.includes('城东泵站班'))
  check('数据未被改动', String(station(1)['设计流量']) === '3.6m³/s')
  // 调度员硬改业务字段 —— 退回
  const dispatcher = pump.saveStationEdit({
    id: 1,
    baseVersion: version(1),
    operator: '王调度',
    changes: { 设计流量: '8.8m³/s' },
  })
  check('调度员改业务字段被退回', dispatcher.ok === false && dispatcher.message.includes('调度员只能查阅'))
  // 本班组合法修订 —— 通过
  const allowed = pump.saveStationEdit({
    id: 1,
    baseVersion: version(1),
    operator: '李向东',
    changes: { 设计流量: '4.2m³/s' },
  })
  check('责任班组修订通过', allowed.ok)
  check('修订后版本 +1', version(1) === 2)
  // 班组硬改受限字段 —— 整单退回
  const restricted = pump.saveStationEdit({
    id: 1,
    baseVersion: version(1),
    operator: '李向东',
    changes: { 管护班组: '城南泵站班', 站名: '城东一号泵站改名' },
  })
  check('班组直接改管护班组被退回', restricted.ok === false && restricted.message.includes('管护班组'))
  check('整单退回：同单里的合法改名也没落库', String(station(1)['站名']) === '城东一号泵站')
}

console.log('规则2：未派班组的站单独成队；派完回正常档案')
{
  resetAllRows()
  const pending = pump.unassignedStations()
  check('待派队列挑出 2 座未派班站', pending.length === 2 && pending.every((r) => String(r['管护班组']) === '尚未派班组'))
  // 班组值班人不能派班
  const crewAssign = pump.assignStation({ id: 5, baseVersion: 1, operator: '李向东', toTeam: '城东泵站班', reason: '' })
  check('班组派班被拒', crewAssign.ok === false)
  // 未派班站的档案改不动
  const editSealed = pump.saveStationEdit({
    id: 5,
    baseVersion: 1,
    operator: '王调度',
    changes: { 站名: '滨河泵站' },
  })
  check('封存站档案改不动', editSealed.ok === false && editSealed.message.includes('封存'))
  // 调度员派班
  const assigned = pump.assignStation({
    id: 5,
    baseVersion: 1,
    operator: '王调度',
    toTeam: '城东泵站班',
    reason: '建成移交',
  })
  check('调度员派班成功', assigned.ok)
  check('派完离开待派队列', pump.unassignedStations().every((r) => Number(r.id) !== 5))
  check('派完进入正常档案且可编辑', (() => {
    const ok = pump.saveStationEdit({
      id: 5,
      baseVersion: version(5),
      operator: '李向东',
      changes: { 站长: '李向东' },
    })
    return ok.ok
  })())
  check('移交链含派班记录', station(5)['移交记录'].at(-1).kind === '派班')
}

console.log('规则3：班组换人后，之前定下来的数据仍算原班组')
{
  resetAllRows()
  // 城东一号原由城北班代管（seed 已内置移交链）
  const ledger = pump.ownershipLedger(station(1))
  const flow = ledger.find((item) => item.field === '设计流量')
  check('移交前定的设计流量仍记城北班', flow.team === '城北泵站班')
  const area = ledger.find((item) => item.field === '服务面积')
  check('移交后核定的服务面积记城东班', area.team === '城东泵站班')
  check('移交链最后一条为城东班', station(1)['移交记录'].at(-1).toTeam === '城东泵站班')
  // 再移交给城南班，旧账不变，新账记城南
  const move = pump.handoverStation({
    id: 1,
    baseVersion: version(1),
    operator: '王调度',
    toTeam: '城南泵站班',
    toDistrict: '城南片',
    reason: '再划片',
  })
  check('第二次移交办结', move.ok)
  const ledger2 = pump.ownershipLedger(station(1))
  check('旧数据仍记原班组城北班', ledger2.find((i) => i.field === '设计流量').team === '城北泵站班')
  check('移交后的字段修订记接收班组', (() => {
    const res = pump.saveStationEdit({
      id: 1,
      baseVersion: version(1),
      operator: '赵海生',
      changes: { 设计流量: '6.0m³/s' },
    })
    if (!res.ok) return false
    const led = pump.ownershipLedger(station(1)).find((i) => i.field === '设计流量')
    return led.team === '城南泵站班' && led.value === '6.0m³/s'
  })())
  check('以最后一次移交为准（管护班组=城南）', String(station(1)['管护班组']) === '城南泵站班')
}

console.log('规则4：在运站数档案与概览同一口径')
{
  resetAllRows()
  check('两个口径初始同为 2', pump.runningStationCount() === 2 && store.countRunningStations() === 2)
  // 停用一座运行中站
  const res = pump.runStationAction({ id: 1, baseVersion: version(1), operator: '李向东', action: '停用泵站' })
  check('停用办结成功', res.ok)
  check('停用后两口径同步核减为 1', pump.runningStationCount() === 1 && store.countRunningStations() === 1)
  // 待投运站投运，两口径同步增加
  pump.assignStation({ id: 5, baseVersion: 1, operator: '王调度', toTeam: '城东泵站班', reason: 'x' })
  pump.runStationAction({ id: 5, baseVersion: version(5), operator: '李向东', action: '提交投运' })
  check('投运后两口径同步为 2', pump.runningStationCount() === 2 && store.countRunningStations() === 2)
}

console.log('规则5：一座站停用办结，该片区调度方案重编')
{
  resetAllRows()
  // 停用城东片城东一号泵站（id=1）
  const res = pump.runStationAction({ id: 1, baseVersion: version(1), operator: '李向东', action: '停用泵站' })
  check('停用办结成功', res.ok)
  check('返回信息带方案重编提示', res.message.includes('待重编'))
  const plans = store.listRows('dispatchplan')
  const p1 = plans.find((p) => Number(p.id) === 1) // 城东片 已批准
  const p2 = plans.find((p) => Number(p.id) === 2) // 城南片 已批准
  const p4 = plans.find((p) => Number(p.id) === 4) // 城北片 已废止
  check('同片区已批准方案 → 待重编', String(p1.status) === '待重编' && p1['重编原因'].includes('停用'))
  check('其他片区方案不受影响', String(p2.status) === '已批准')
  check('已废止方案不重编', String(p4.status) === '已废止')
  // 停用城南片站也触发本片区重编
  const again = pump.runStationAction({ id: 2, baseVersion: version(2), operator: '赵海生', action: '停用泵站' })
  const p2After = store.listRows('dispatchplan').find((p) => Number(p.id) === 2)
  check('城南片站停用也触发本片区方案重编', again.ok && String(p2After.status) === '待重编')
}

console.log('规则6/7：两人并发改同一处，只接受先到一版')
{
  resetAllRows()
  const v1 = version(1)
  const first = pump.saveStationEdit({
    id: 1,
    baseVersion: v1,
    operator: '李向东',
    changes: { 设计流量: '4.5m³/s' },
  })
  const second = pump.saveStationEdit({
    id: 1,
    baseVersion: v1, // 仍拿打开时的旧版本
    operator: '李向东',
    changes: { 设计流量: '5.5m³/s' },
  })
  check('先到提交接受', first.ok)
  check('后到提交以版本冲突退回', second.ok === false && second.message.includes('版本已过期'))
  check('落库的是先到值', String(station(1)['设计流量']) === '4.5m³/s')
  check('版本只推进一次', version(1) === v1 + 1)
  // 后到者重新取版后再提交 —— 通过
  const retry = pump.saveStationEdit({
    id: 1,
    baseVersion: v1 + 1,
    operator: '李向东',
    changes: { 设计流量: '5.5m³/s' },
  })
  check('取最新版后可再提交', retry.ok)
  // 派班/移交/动作同样受乐观锁保护
  const staleAssign = pump.assignStation({ id: 5, baseVersion: 99, operator: '王调度', toTeam: '城东泵站班', reason: '' })
  check('派班也校验版本', staleAssign.ok === false && staleAssign.message.includes('版本已过期'))
  const staleAction = pump.runStationAction({ id: 2, baseVersion: 99, operator: '赵海生', action: '安排检修' })
  check('状态动作也校验版本', staleAction.ok === false && staleAction.message.includes('版本已过期'))
}

console.log('附加：状态动作权限与停用终态')
{
  resetAllRows()
  // 调度员不能代班组提交投运/检修
  const noDispatch = pump.runStationAction({ id: 1, baseVersion: version(1), operator: '王调度', action: '安排检修' })
  check('调度员不能代办班组动作', noDispatch.ok === false)
  // 停用后终态
  pump.runStationAction({ id: 1, baseVersion: version(1), operator: '李向东', action: '停用泵站' })
  const after = pump.runStationAction({ id: 1, baseVersion: version(1), operator: '李向东', action: '提交投运' })
  check('停用办结后不能再投运', after.ok === false)
  // 未派班站不能办理动作
  const sealed = pump.runStationAction({ id: 5, baseVersion: version(5), operator: '王调度', action: '停用泵站' })
  check('未派班站不能办理动作', sealed.ok === false && sealed.message.includes('派班组'))
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exitCode = 1
}

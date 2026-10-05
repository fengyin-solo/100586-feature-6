<template>
  <section class="page" data-module="pumpstation">
    <header class="page-head">
      <div>
        <h2>泵站台账管理</h2>
        <p class="page-desc">
          每座站定一个管护班组：班组之外打开只能查阅、改不动，硬提交逐字段退回；责任在片区间划转一律走调度员责任移交，
          移交前定档的数据仍算原班组。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出泵站台账清单</button>
        <button class="btn ghost" type="button" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card stat-highlight">
        <span class="stat-label">在运泵站（与运行概览同口径）</span>
        <strong class="stat-value">{{ runningCount }}</strong>
      </article>
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="tabs" role="tablist">
      <button
        class="tab"
        :class="{ active: tab === 'archive' }"
        type="button"
        role="tab"
        @click="tab = 'archive'"
      >
        正常档案
      </button>
      <button
        class="tab"
        :class="{ active: tab === 'unassigned' }"
        type="button"
        role="tab"
        @click="tab = 'unassigned'"
      >
        待派班组（{{ unassigned.length }}）
      </button>
      <button
        class="tab"
        :class="{ active: tab === 'drill' }"
        type="button"
        role="tab"
        @click="openDrill"
      >
        并发提交演练
      </button>
    </div>

    <p class="identity-banner" :class="store.isDispatcher ? 'banner-dispatch' : 'banner-crew'">
      当前身份：<strong>{{ store.operator }}</strong>
      （{{ store.isDispatcher ? '调度员：可派班、办理责任移交、督办停用办结，档案字段只读' : `班组值班人：仅可改「${store.team}」管护站的业务字段` }}）
    </p>

    <p v-if="successMessage" class="success-text">{{ successMessage }}</p>
    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <!-- 正常档案 -->
    <template v-if="tab === 'archive'">
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>站名</span>
          <input v-model="filters['站名']" placeholder="按站名检索" />
        </label>
        <label class="filter-item">
          <span>所属片区</span>
          <input v-model="filters['所属片区']" placeholder="按片区检索" />
        </label>
        <label class="filter-item">
          <span>管护班组</span>
          <input v-model="filters['管护班组']" placeholder="按班组检索" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>档案版本</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">
              {{ column === '管护班组' ? teamCell(row) : (row[column] ?? '—') }}
            </td>
            <td>v{{ row['版本'] ?? 1 }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openArchive(row)">
                {{ canEdit(row) ? '查阅/修订档案' : '查阅档案' }}
              </button>
              <button
                v-if="store.isDispatcher"
                class="link"
                type="button"
                @click="openHandover(row)"
              >
                责任移交
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的泵站档案</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ total }} 座在册泵站；在运 {{ runningCount }} 座（与运行概览同一个数）</span>
      </footer>
    </template>

    <!-- 待派班组：一直没派班组的站单独挑出来，派完自动回到正常档案 -->
    <template v-if="tab === 'unassigned'">
      <p class="page-desc">下列泵站建成后尚未定管护班组，档案处于封存状态（谁都改不动）。请调度员派班，派完即回到正常档案。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>编号</th><th>站名</th><th>所属片区</th><th>设计流量</th><th>投运日期</th><th>档案版本</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in unassigned" :key="String(row.id)">
            <td>{{ row.id }}</td>
            <td>{{ row['站名'] }}</td>
            <td>{{ row['所属片区'] }}</td>
            <td>{{ row['设计流量'] }}</td>
            <td>{{ row['投运日期'] }}</td>
            <td>v{{ row['版本'] ?? 1 }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openArchive(row)">查阅</button>
              <button
                class="link"
                :disabled="!store.isDispatcher"
                :title="store.isDispatcher ? '' : '只有调度员能派班'"
                type="button"
                @click="openAssign(row)"
              >
                派班组
              </button>
            </td>
          </tr>
          <tr v-if="!unassigned.length">
            <td colspan="7" class="empty-state">待派队列已清空，所有泵站都已落实管护班组</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 并发演练：模拟两位值班人同时打开同一站、先后提交同一处 -->
    <template v-if="tab === 'drill'">
      <div class="drill-box">
        <h3>两位值班人并发提交同一处改动</h3>
        <p class="page-desc">
          两份表单都基于档案打开瞬间的同一版本（v{{ drill ? drill.baseVersion : '-' }}）：
          先到的一版落档并把版本 +1，后到的一版因乐观锁校验失败被整单退回。实际场景也可以开两个浏览器标签页、
          分别切换不同值班人后同时操作，行为一致。
        </p>
        <table class="data-table">
          <thead>
            <tr><th>值班人</th><th>所属班组</th><th>改「站名」为</th><th>持有版本</th><th>提交结果</th></tr>
          </thead>
          <tbody>
            <tr v-for="(form, idx) in drillForms" :key="idx">
              <td>{{ form.operator }}</td>
              <td>{{ form.team }}</td>
              <td><input v-model="form.value" /></td>
              <td>v{{ form.baseVersion }}</td>
              <td>
                <button class="btn" type="button" @click="submitDrill(idx)">提交</button>
                <span v-if="form.result" :class="form.ok ? 'success-text' : 'error-text'">{{ form.result }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="drill-actions">
          <button class="btn ghost" type="button" @click="openDrill">重置演练（重新取版）</button>
          <button class="btn ghost" type="button" @click="refreshDrillVersions">不重开表单，刷新持有版本</button>
        </div>
      </div>
    </template>

    <!-- 档案抽屉 -->
    <div v-if="archiveRow" class="modal-mask" @click.self="closeArchive">
      <div class="modal modal-wide">
        <header class="modal-head">
          <h3>{{ archiveRow['站名'] }} · 泵站档案（v{{ archiveRow['版本'] ?? 1 }}）</h3>
          <button class="btn ghost" type="button" @click="closeArchive">关闭</button>
        </header>

        <p class="identity-banner" :class="canEdit(archiveRow) ? 'banner-crew' : 'banner-dispatch'">
          管护班组：<strong>{{ teamCell(archiveRow) }}</strong>
          <template v-if="isUnassignedRow(archiveRow)"> — 封存中，派班后才能修订</template>
          <template v-else-if="canEdit(archiveRow)"> — 你是本站值班人，下列业务字段可修订并提交</template>
          <template v-else> — 你不属于该班组，只能查阅，提交会被退回</template>
        </p>

        <div class="form-grid">
          <label v-for="field in crewFields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input v-model="editDraft[field]" :disabled="!canEdit(archiveRow) && !forceEdit" />
          </label>
          <label class="form-item">
            <span>所属片区（受限，走责任移交）</span>
            <input v-model="editDraft['所属片区']" :disabled="!forceEdit" />
          </label>
          <label class="form-item">
            <span>管护班组（受限，走责任移交）</span>
            <input v-model="editDraft['管护班组']" :disabled="!forceEdit" />
          </label>
        </div>

        <div class="modal-actions">
          <button class="btn primary" type="button" :disabled="!canEdit(archiveRow)" @click="submitArchive">
            提交修订（带版本号）
          </button>
          <button
            v-if="!isUnassignedRow(archiveRow)"
            class="btn"
            type="button"
            @click="forceEdit = !forceEdit"
          >
            {{ forceEdit ? '取消强制编辑' : '强制编辑并硬提交（越权演练）' }}
          </button>
          <button v-if="forceEdit" class="btn primary" type="button" @click="submitArchive">
            仍然提交
          </button>
          <span class="field-hint">
            {{ forceEdit
              ? '你正在以无权限身份硬提交：服务端会整单退回，并逐项指出哪一项不该由你改。'
              : '「所属片区 / 管护班组」不该由班组改，要划片换人请让调度员走责任移交。' }}
          </span>
        </div>

        <h4 class="section-title">字段定档台账（换人以后，之前定下来的数据仍算原班组）</h4>
        <table class="data-table inner-table">
          <thead>
            <tr><th>字段</th><th>当前值</th><th>定档班组</th><th>定档值班人</th><th>定档时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in ledger" :key="item.field">
              <td>{{ item.field }}</td>
              <td>{{ item.value }}</td>
              <td>{{ item.team || '调度台' }}</td>
              <td>{{ item.operator }}</td>
              <td>{{ item.at }}</td>
            </tr>
          </tbody>
        </table>

        <h4 class="section-title">责任移交链（以最后一次责任移交为准）</h4>
        <table class="data-table inner-table">
          <thead>
            <tr><th>序</th><th>类型</th><th>从班组</th><th>到班组</th><th>片区变化</th><th>办理人</th><th>时间</th><th>事由</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in handovers" :key="item.seq">
              <td>{{ item.seq }}</td>
              <td>{{ item.kind }}</td>
              <td>{{ item.fromTeam || '—' }}</td>
              <td>{{ item.toTeam }}</td>
              <td>{{ item.fromDistrict || '—' }} → {{ item.toDistrict }}</td>
              <td>{{ item.operator }}</td>
              <td>{{ item.at }}</td>
              <td>{{ item.reason }}</td>
            </tr>
          </tbody>
        </table>

        <h4 class="section-title">办理动作</h4>
        <div class="row-actions">
          <button
            v-for="action in actions"
            :key="action"
            class="btn"
            type="button"
            :disabled="!canRunAction(archiveRow, action)"
            @click="runStationAction(action)"
          >
            {{ action }}
          </button>
        </div>
        <p class="field-hint">停用办结后，该片区在执行的调度方案将全部退回「待重编」，在运站数同步核减。</p>
      </div>
    </div>

    <!-- 派班弹窗 -->
    <div v-if="assignTarget" class="modal-mask" @click.self="assignTarget = null">
      <div class="modal">
        <header class="modal-head">
          <h3>派定管护班组 · {{ assignTarget['站名'] }}</h3>
          <button class="btn ghost" type="button" @click="assignTarget = null">关闭</button>
        </header>
        <div class="form-grid">
          <label class="form-item">
            <span>管护班组</span>
            <select v-model="assignDraft.toTeam">
              <option value="" disabled>请选择班组</option>
              <option v-for="team in crewTeams" :key="team" :value="team">{{ team }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>所属片区（可调整）</span>
            <input v-model="assignDraft.toDistrict" />
          </label>
          <label class="form-item form-wide">
            <span>派班事由</span>
            <input v-model="assignDraft.reason" placeholder="如：建成移交，首次派定管护班组" />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitAssign">确认派班</button>
        </div>
      </div>
    </div>

    <!-- 责任移交弹窗 -->
    <div v-if="handoverTarget" class="modal-mask" @click.self="handoverTarget = null">
      <div class="modal">
        <header class="modal-head">
          <h3>责任移交 · {{ handoverTarget['站名'] }}</h3>
          <button class="btn ghost" type="button" @click="handoverTarget = null">关闭</button>
        </header>
        <p class="field-hint">
          当前责任：{{ handoverTarget['管护班组'] }}（{{ handoverTarget['所属片区'] }}）。
          移交后新改的数据记接收班组，移交前数据在定档台账里仍记原班组。
        </p>
        <div class="form-grid">
          <label class="form-item">
            <span>接收班组</span>
            <select v-model="handoverDraft.toTeam">
              <option v-for="team in crewTeams" :key="team" :value="team">{{ team }}</option>
            </select>
          </label>
          <label class="form-item">
            <span>划入片区</span>
            <input v-model="handoverDraft.toDistrict" />
          </label>
          <label class="form-item form-wide">
            <span>移交事由</span>
            <input v-model="handoverDraft.reason" placeholder="如：片区重划，站点随片划转" />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitHandover">办结移交</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  assignStation,
  downloadEntries,
  filterRows,
  handoverStation,
  isUnassigned,
  listRows,
  moduleMeta,
  ownershipLedger,
  resetAllRows,
  runStationAction as applyStationAction,
  runningStationCount,
  saveStationEdit,
  stationVersion,
  unassignedStations,
} from '@/api/local-service'
import { CREW_TEAMS, STATION_CREW_FIELDS } from '@/data/pump-domain'
import type { EntryRow, FieldHistory, HandoverRecord } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const meta = moduleMeta('pumpstation')
const columns = ['管护班组', '站名', '所属片区', '设计流量', '装机台数', '服务面积', '投运日期', '站长', '站点状态']
const crewFields = [...STATION_CREW_FIELDS]
const actions = ['提交投运', '安排检修', '停用泵站']
const crewTeams = CREW_TEAMS

const tab = ref<'archive' | 'unassigned' | 'drill'>('archive')
const rows = ref<EntryRow[]>([])
const unassigned = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})

const runningCount = computed(() => runningStationCount())
const stats = computed(() => [
  { label: '检修中泵站', value: rows.value.filter((row) => String(row.status) === '检修中').length },
  { label: '待投运泵站', value: rows.value.filter((row) => String(row.status) === '待投运').length },
  { label: '已停用泵站', value: rows.value.filter((row) => String(row.status) === '已停用').length },
  { label: '待派班组', value: unassigned.value.length },
])
const statusSummary = computed(() =>
  ['待投运', '运行中', '检修中', '已停用'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function teamCell(row: EntryRow): string {
  const value = row['管护班组']
  return !value || isUnassigned(row) ? '尚未派班组' : String(value)
}

function isUnassignedRow(row: EntryRow): boolean {
  return isUnassigned(row)
}

function canEdit(row: EntryRow): boolean {
  if (isUnassigned(row)) {
    return false
  }
  if (store.isDispatcher) {
    return false
  }
  return store.team === String(row['管护班组'])
}

function canRunAction(row: EntryRow, action: string): boolean {
  if (isUnassigned(row)) {
    return false
  }
  if (String(row.status) === '已停用') {
    return false
  }
  if (store.isDispatcher) {
    return action === '停用泵站'
  }
  return store.team === String(row['管护班组'])
}

function flash(ok: boolean, message: string) {
  errorMessage.value = ok ? '' : message
  successMessage.value = ok ? message : ''
}

function reload() {
  const all = listRows('pumpstation')
  unassigned.value = unassignedStations()
  rows.value = filterRows(all.filter((row) => !isUnassigned(row)), filters.value)
  total.value = rows.value.length
  if (archiveRow.value) {
    const fresh = all.find((row) => Number(row.id) === Number(archiveRow.value?.id))
    if (fresh) {
      archiveRow.value = fresh
    }
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function resetDemo() {
  resetAllRows()
  reload()
  flash(true, '演示数据已重置回播种状态')
}

// ---------- 档案抽屉 ----------
const archiveRow = ref<EntryRow | null>(null)
const editDraft = reactive<Record<string, string>>({})
const forceEdit = ref(false)
const ledger = ref<FieldHistory[]>([])
const handovers = ref<HandoverRecord[]>([])

function openArchive(row: EntryRow) {
  const fresh = listRows('pumpstation').find((item) => Number(item.id) === Number(row.id)) ?? row
  archiveRow.value = fresh
  forceEdit.value = false
  ledger.value = ownershipLedger(fresh)
  handovers.value = ((fresh['移交记录'] as HandoverRecord[] | undefined) ?? [])
  for (const field of crewFields) {
    editDraft[field] = String(fresh[field] ?? '')
  }
  editDraft['所属片区'] = String(fresh['所属片区'] ?? '')
  editDraft['管护班组'] = teamCell(fresh)
  errorMessage.value = ''
  successMessage.value = ''
}

function closeArchive() {
  archiveRow.value = null
}

function submitArchive() {
  if (!archiveRow.value) {
    return
  }
  const id = Number(archiveRow.value.id)
  const result = saveStationEdit({
    id,
    baseVersion: stationVersion(archiveRow.value),
    operator: store.operator,
    changes: { ...editDraft },
  })
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  reload()
  const fresh = listRows('pumpstation').find((row) => Number(row.id) === id)
  if (fresh) {
    openArchive(fresh)
  }
  flash(true, result.message)
}

function runStationAction(action: string) {
  if (!archiveRow.value) {
    return
  }
  const id = Number(archiveRow.value.id)
  const result = applyStationAction({
    id,
    baseVersion: stationVersion(archiveRow.value),
    operator: store.operator,
    action,
  })
  if (!result.ok) {
    flash(false, result.message)
    return
  }
  reload()
  const fresh = listRows('pumpstation').find((row) => Number(row.id) === id)
  if (fresh) {
    openArchive(fresh)
  }
  flash(true, result.message)
}

// ---------- 派班 ----------
const assignTarget = ref<EntryRow | null>(null)
const assignDraft = reactive({ toTeam: '', toDistrict: '', reason: '' })

function openAssign(row: EntryRow) {
  assignTarget.value = row
  assignDraft.toTeam = ''
  assignDraft.toDistrict = String(row['所属片区'] ?? '')
  assignDraft.reason = ''
  errorMessage.value = ''
}

function submitAssign() {
  if (!assignTarget.value) {
    return
  }
  const result = assignStation({
    id: Number(assignTarget.value.id),
    baseVersion: stationVersion(assignTarget.value),
    operator: store.operator,
    toTeam: assignDraft.toTeam,
    toDistrict: assignDraft.toDistrict,
    reason: assignDraft.reason,
  })
  flash(result.ok, result.message)
  if (result.ok) {
    assignTarget.value = null
    reload()
  }
}

// ---------- 责任移交 ----------
const handoverTarget = ref<EntryRow | null>(null)
const handoverDraft = reactive({ toTeam: '', toDistrict: '', reason: '' })

function openHandover(row: EntryRow) {
  handoverTarget.value = row
  handoverDraft.toTeam = String(row['管护班组'] ?? '')
  handoverDraft.toDistrict = String(row['所属片区'] ?? '')
  handoverDraft.reason = ''
  errorMessage.value = ''
}

function submitHandover() {
  if (!handoverTarget.value) {
    return
  }
  const result = handoverStation({
    id: Number(handoverTarget.value.id),
    baseVersion: stationVersion(handoverTarget.value),
    operator: store.operator,
    toTeam: handoverDraft.toTeam,
    toDistrict: handoverDraft.toDistrict,
    reason: handoverDraft.reason,
  })
  flash(result.ok, result.message)
  if (result.ok) {
    handoverTarget.value = null
    reload()
  }
}

// ---------- 并发演练 ----------
type DrillForm = { operator: string; team: string; value: string; baseVersion: number; result: string; ok: boolean }
const drillForms = ref<DrillForm[]>([])
const drill = computed(() => drillForms.value[0] ?? null)

function openDrill() {
  tab.value = 'drill'
  const target = listRows('pumpstation').find((row) => String(row['站名']) === '城东一号泵站') ?? listRows('pumpstation')[0]
  const base = stationVersion(target)
  drillForms.value = [
    { operator: '李向东', team: '城东泵站班', value: String(target['站名']) + '-甲改', baseVersion: base, result: '', ok: false },
    { operator: '赵海生', team: '城南泵站班', value: String(target['站名']) + '-乙改', baseVersion: base, result: '', ok: false },
  ]
  drillTargetId.value = Number(target.id)
  errorMessage.value = ''
}
const drillTargetId = ref(0)

function submitDrill(idx: number) {
  const form = drillForms.value[idx]
  const result = saveStationEdit({
    id: drillTargetId.value,
    baseVersion: form.baseVersion,
    operator: form.operator,
    changes: { 站名: form.value },
  })
  form.result = result.message
  form.ok = result.ok
  if (result.ok) {
    reload()
    // 先到者落版后持有版本跟随前进；后到者仍拿旧版本，直到显式重新取版
    form.baseVersion = stationVersion(listRows('pumpstation').find((row) => Number(row.id) === drillTargetId.value)!)
  }
}

function refreshDrillVersions() {
  const target = listRows('pumpstation').find((row) => Number(row.id) === drillTargetId.value)
  if (!target) {
    return
  }
  for (const form of drillForms.value) {
    form.baseVersion = stationVersion(target)
    form.result = `已重新取版（v${form.baseVersion}），可以再次提交`
    form.ok = true
  }
}

onMounted(reload)
</script>

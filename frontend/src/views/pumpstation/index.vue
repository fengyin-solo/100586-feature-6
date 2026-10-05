<template>
  <section class="page" data-module="pumpstation">
    <header class="page-head">
      <div>
        <h2>泵站台账管理</h2>
        <p class="page-desc">每座站由管护班组负责：本班组才能改档案，班组之外只能查阅；没派班组的站单独列在下面。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记排水泵站</button>
        <button class="btn" type="button" @click="exportRows">导出泵站台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>
    <p class="basis-note">在运站数与运营概览同口径，以最后一次责任移交为准：{{ activeBasis }}</p>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section v-if="unassigned.length" class="panel unassigned-panel">
      <h3 class="panel-title">待派班组（{{ unassigned.length }} 座）</h3>
      <p class="panel-desc">这些站一直没派管护班组，先派班组再回正常档案；派班前谁也改不动档案。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>站名</th>
            <th>所属片区</th>
            <th>设计流量</th>
            <th>当前状态</th>
            <th>派给班组</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in unassigned" :key="String(row.id)">
            <td>{{ row['站名'] }}</td>
            <td>{{ row['所属片区'] }}</td>
            <td>{{ row['设计流量'] }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <select v-model="assignChoices[Number(row.id)]" class="inline-select">
                <option v-for="team in teamOptions" :key="team" :value="team">{{ team }}</option>
              </select>
              <button class="link" type="button" @click="assignTeam(row)">派班组</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!isSteward(row)"
              :title="isSteward(row) ? '' : '只有管护班组能操作，其他人只能查阅'"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openEdit(row)">
              {{ isSteward(row) ? '编辑档案' : '查阅档案' }}
            </button>
            <button class="link" type="button" @click="openTransfer(row)">责任移交</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">正常档案里暂无泵站，未派班组的站单列在上方</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条泵站台账记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
    </footer>

    <div v-if="editing" class="modal-mask" @click.self="closeEdit">
      <div class="modal">
        <h3 class="modal-title">
          {{ canEditForm ? '编辑泵站档案' : '查阅泵站档案' }}——{{ editing.row['站名'] }}
          <span class="version-tag">v{{ editing.version }}</span>
        </h3>
        <p v-if="!canEditForm" class="panel-desc">
          该站由「{{ editing.row['管护班组'] }}」管护，你所在的{{ session.operatorTeam || '调度值班室' }}只能查阅、改不动。
        </p>
        <div class="form-grid">
          <label v-for="field in editableFields" :key="field" class="form-item">
            <span>{{ field }}</span>
            <input v-model="editForm[field]" :disabled="!canEditForm" />
            <small class="attr-note">
              {{ attrText(field) }}
            </small>
          </label>
          <label class="form-item">
            <span>管护班组</span>
            <input :value="editing.row['管护班组']" disabled />
            <small class="attr-note">只能走责任移交，不能随档案编辑改</small>
          </label>
        </div>
        <p v-if="editError" class="error-text">{{ editError }}</p>
        <div class="modal-actions">
          <button v-if="canEditForm" class="btn primary" type="button" @click="submitEdit">提交改动</button>
          <button class="btn" type="button" @click="closeEdit">关闭</button>
        </div>
      </div>
    </div>

    <div v-if="transferring" class="modal-mask" @click.self="closeTransfer">
      <div class="modal">
        <h3 class="modal-title">责任移交——{{ transferring.row['站名'] }}</h3>
        <p class="panel-desc">
          当前管护班组：{{ transferring.row['管护班组'] || '（未派班组）' }}；移交后之前定稿的数据仍记在原班组名下。
        </p>
        <label class="form-item">
          <span>移交给</span>
          <select v-model="transferChoice" class="inline-select">
            <option v-for="team in teamOptions" :key="team" :value="team">{{ team }}</option>
          </select>
        </label>
        <template v-if="transferHistory.length">
          <h4 class="panel-title">移交记录</h4>
          <ul class="history-list">
            <li v-for="(item, index) in transferHistory" :key="index">
              {{ item.at }} · {{ item.fromTeam }} → {{ item.toTeam }} · 经办 {{ item.operator }}
            </li>
          </ul>
        </template>
        <p v-if="transferError" class="error-text">{{ transferError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitTransfer">确认移交</button>
          <button class="btn" type="button" @click="closeTransfer">取消</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  activeStationCount,
  assignStationTeam,
  downloadEntries,
  listEntries,
  listStations,
  listUnassignedStations,
  moduleMeta,
  runAction as applyAction,
  stationAttribution,
  stationTransfers,
  updateStation,
} from '@/api/local-service'
import { TEAM_NAMES } from '@/data/stewardship'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('pumpstation')
const columns = ["站名", "所属片区", "设计流量", "装机台数", "服务面积", "投运日期", "站长", "站点状态", "管护班组"]
const actions = ["提交投运", "安排检修", "停用泵站"]
const statuses = ["待投运", "运行中", "检修中", "已停用"]
const editableFields = columns.filter((column) => column !== '管护班组')
const teamOptions = TEAM_NAMES

const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const unassigned = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const activeCount = ref(0)
const activeBasis = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const assignChoices = reactive<Record<number, string>>({})

const stats = computed(() => [
  { label: '运行中泵站', value: activeCount.value },
  { label: '检修中泵站', value: countByStatus('检修中') },
  { label: '待投运泵站', value: countByStatus('待投运') },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({ status, count: countByStatus(status) })),
)

// 状态统计覆盖全部泵站（含待派班组的），在运站数走与概览相同的口径。
const allRows = ref<EntryRow[]>([])

function countByStatus(status: string): number {
  return allRows.value.filter((row) => String(row.status) === status).length
}

function isSteward(row: EntryRow): boolean {
  return session.operatorTeam !== '' && session.operatorTeam === String(row['管护班组'] ?? '')
}

// ---- 编辑 / 查阅档案 ----
const editing = ref<{ row: EntryRow; version: number } | null>(null)
const editForm = reactive<Record<string, string>>({})
const editError = ref('')
const editAttribution = ref<Record<string, { team: string; operator: string; at: string }>>({})

const canEditForm = computed(() => (editing.value ? isSteward(editing.value.row) : false))

function openEdit(row: EntryRow) {
  editing.value = { row, version: Number(row['版本'] ?? 1) }
  for (const field of editableFields) {
    editForm[field] = String(row[field] ?? '')
  }
  editAttribution.value = stationAttribution(Number(row.id))
  editError.value = ''
}

function closeEdit() {
  editing.value = null
  editError.value = ''
}

function attrText(field: string): string {
  const attr = editAttribution.value[field]
  return attr ? `定稿：${attr.team} · ${attr.operator} · ${attr.at}` : '暂无留痕'
}

function submitEdit() {
  if (!editing.value) {
    return
  }
  const result = updateStation(
    Number(editing.value.row.id),
    { ...editForm },
    editing.value.version,
    session.operator,
  )
  if (!result.ok) {
    editError.value = result.message
    return
  }
  closeEdit()
  okMessage.value = result.message
  reload()
}

// ---- 责任移交 ----
const transferring = ref<{ row: EntryRow } | null>(null)
const transferChoice = ref('')
const transferError = ref('')
const transferHistory = ref<ReturnType<typeof stationTransfers>>([])

function openTransfer(row: EntryRow) {
  transferring.value = { row }
  transferChoice.value = teamOptions.find((team) => team !== String(row['管护班组'] ?? '')) ?? teamOptions[0]
  transferHistory.value = stationTransfers(Number(row.id))
  transferError.value = ''
}

function closeTransfer() {
  transferring.value = null
  transferError.value = ''
}

function submitTransfer() {
  if (!transferring.value) {
    return
  }
  const result = assignStationTeam(Number(transferring.value.row.id), transferChoice.value, session.operator)
  if (!result.ok) {
    transferError.value = result.message
    return
  }
  closeTransfer()
  okMessage.value = result.message
  reload()
}

function assignTeam(row: EntryRow) {
  const team = assignChoices[Number(row.id)] ?? teamOptions[0]
  const result = assignStationTeam(Number(row.id), team, session.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '排水泵站登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  okMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, session.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listStations(filters.value)
    rows.value = payload.items
    total.value = payload.total
    unassigned.value = listUnassignedStations()
    for (const row of unassigned.value) {
      if (!assignChoices[Number(row.id)]) {
        assignChoices[Number(row.id)] = teamOptions[0]
      }
    }
    const active = activeStationCount()
    activeCount.value = active.count
    activeBasis.value = active.basis
    allRows.value = listEntries(meta.key).items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '泵站台账列表读取失败'
  }
}

onMounted(reload)
</script>

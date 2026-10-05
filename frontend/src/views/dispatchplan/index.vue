<template>
  <section class="page" data-module="dispatchplan">
    <header class="page-head">
      <div>
        <h2>排水调度方案管理</h2>
        <p class="page-desc">维护调度方案，围绕所属片区、方案名称、适用雨型、涉及泵站做登记；片区内泵站停用办结时，方案自动退回「待重编」。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记调度方案</button>
        <button class="btn" type="button" @click="exportRows">导出排水调度方案清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in liveStats" :key="item.label" class="stat-card" :class="{ 'stat-warn': item.warn }">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p v-if="rebuildCount > 0" class="rebuild-banner">
      有 {{ rebuildCount }} 份方案因片区内泵站停用办结退回「待重编」，重编并经审核批准后方可继续执行。
    </p>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>方案名称</span>
        <input v-model="filters['方案名称']" placeholder="按方案名称检索" />
      </label>
      <label class="filter-item">
        <span>所属片区</span>
        <input v-model="filters['所属片区']" placeholder="按片区检索" />
      </label>
      <label class="filter-item">
        <span>方案状态</span>
        <input v-model="filters['status']" placeholder="按状态检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>重编原因 / 可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-rebuild': String(row.status) === '待重编' }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <span v-if="row['重编原因']" class="rebuild-reason">{{ row['重编原因'] }}</span>
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无排水调度方案数据，可先登记调度方案</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条排水调度方案记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('dispatchplan')
const columns = ['方案编号', '方案名称', '所属片区', '适用雨型', '涉及泵站', '编制人', '审核人', '生效日期', '方案状态']
const statuses = ['待编制', '待审核', '已批准', '待重编', '已废止']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const rebuildCount = computed(() => rows.value.filter((row) => String(row.status) === '待重编').length)
const liveStats = computed(() => [
  { label: '待编制方案', value: rows.value.filter((row) => String(row.status) === '待编制').length, warn: false },
  { label: '待审核方案', value: rows.value.filter((row) => String(row.status) === '待审核').length, warn: false },
  { label: '已批准方案', value: rows.value.filter((row) => String(row.status) === '已批准').length, warn: false },
  { label: '待重编方案', value: rebuildCount.value, warn: true },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 不同状态下可办理的动作：待重编方案先走「重新编制」回到审核，不再显示批准/废止以外的错路
function actionsFor(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待编制') {
    return ['提交编制']
  }
  if (status === '待审核') {
    return ['批准方案', '废止方案']
  }
  if (status === '已批准') {
    return ['废止方案']
  }
  if (status === '待重编') {
    return ['重新编制', '废止方案']
  }
  return []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '调度方案登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const { ['status']: statusFilter, ...fieldFilters } = filters.value
    const payload = listEntries(meta.key, fieldFilters)
    const keyword = String(statusFilter ?? '').trim()
    rows.value = keyword
      ? payload.items.filter((row) => String(row.status).includes(keyword))
      : payload.items
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '排水调度方案列表读取失败'
  }
}

onMounted(reload)
</script>

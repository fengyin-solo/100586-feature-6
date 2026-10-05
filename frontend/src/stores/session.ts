import { defineStore } from 'pinia'

import { OPERATORS } from '@/data/pump-domain'

const IDENTITY_KEY = 'drainage-pump:identity'

// 身份按标签页存（sessionStorage）：开两个标签页选不同值班人，就是两位值班人并发。
function readIdentity(): string {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    const saved = window.sessionStorage.getItem(IDENTITY_KEY)
    if (saved && OPERATORS.some((item) => item.name === saved)) {
      return saved
    }
  }
  return OPERATORS[0].name
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: readIdentity(),
    shiftLabel: '白班 08:00-20:00',
    scope: '城市排水防涝泵站运行与内涝处置管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    identity(state) {
      return OPERATORS.find((item) => item.name === state.operator) ?? OPERATORS[0]
    },
    isDispatcher(): boolean {
      return this.identity.kind === 'dispatcher'
    },
    team(): string {
      return this.identity.team
    },
  },
  actions: {
    setOperator(name: string) {
      this.operator = name
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(IDENTITY_KEY, name)
      }
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})

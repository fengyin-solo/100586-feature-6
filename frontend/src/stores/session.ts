import { defineStore } from 'pinia'

import { DUTY_OPERATORS, teamOf } from '@/data/stewardship'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市排水防涝泵站运行与内涝处置管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    /** 当前值班人所在的管护班组；调度值班室不在任何班组，返回空串。 */
    operatorTeam: (state) => teamOf(state.operator),
    operatorOptions: () => DUTY_OPERATORS,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(name: string) {
      if (DUTY_OPERATORS.includes(name)) {
        this.operator = name
      }
    },
  },
})

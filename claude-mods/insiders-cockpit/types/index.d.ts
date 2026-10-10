export type Stats = {
  time: string
  contextPercent: number | null
  costUsd: number | null
  fiveHourPercent: number | null
  turns: number
  branch: string | null
}

export type LastTurn = { seconds: number; answer: string }

declare module 'claude-code' {
  interface PluginState {
    'insiders-cockpit': {
      stats: Stats | null
      last: LastTurn | null
      isBusy: boolean
      isBandHidden: boolean
    }
  }
}

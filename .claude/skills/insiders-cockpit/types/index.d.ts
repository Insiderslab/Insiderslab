export type Stats = {
  time: string
  contextPercent: number | null
  costUsd: number | null
  fiveHourPercent: number | null
  turns: number
  branch: string | null
}

export type LastTurn = { seconds: number; answer: string }

/** Una chat (sessione cloud) come la mostra il pannello "Le mie chat". */
export type ChatGroup = 'waiting' | 'working' | 'review' | 'failed' | 'done'

export type ChatRow = {
  id: string
  title: string
  group: ChatGroup
  detail: string
  updatedAt: number
  isUnread: boolean
  isThis: boolean
}

export type ChatList = {
  rows: ChatRow[]
  checkedAt: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'insiders-cockpit': {
      stats: Stats | null
      last: LastTurn | null
      isBusy: boolean
      isBandHidden: boolean
      chats: ChatList | null
    }
  }
}

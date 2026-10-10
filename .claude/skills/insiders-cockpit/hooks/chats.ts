import type { ChatGroup, ChatRow } from '../types'

type RawSession = {
  id?: string
  title?: string
  status_bucket?: string
  updated_at?: string
  unread?: boolean
  task_summary?: string
  post_turn_summary?: { status_category?: string; status_detail?: string; needs_action?: string; recent_action?: string }
  external_metadata?: { task_summary?: string; post_turn_summary?: { needs_action?: string; status_detail?: string; recent_action?: string } }
}

function groupOf(raw: RawSession): ChatGroup {
  const bucket = raw.status_bucket ?? ''
  const category = raw.post_turn_summary?.status_category ?? ''
  if (bucket.endsWith('BLOCKED') || category === 'need_input') {
    return 'waiting'
  }
  if (bucket.endsWith('WORKING')) {
    return 'working'
  }
  if (bucket.endsWith('REVIEW_READY')) {
    return 'review'
  }
  if (bucket.endsWith('FAILED')) {
    return 'failed'
  }

  return 'done'
}

function detailOf(raw: RawSession, group: ChatGroup): string {
  const summary = raw.post_turn_summary ?? raw.external_metadata?.post_turn_summary
  const task = raw.task_summary ?? raw.external_metadata?.task_summary
  const candidates =
    group === 'waiting'
      ? [summary?.needs_action, summary?.status_detail, task]
      : group === 'working'
        ? [task, summary?.status_detail]
        : [summary?.status_detail, summary?.recent_action, task]

  return candidates.find(text => text !== undefined && text !== '') ?? ''
}

/**
 * Legge la risposta di list_sessions (testo con dentro il JSON, a volte
 * avvolto in un'intestazione) e la trasforma in righe per il pannello.
 */
export function parseSessions(text: string, thisId: string | null): ChatRow[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('risposta senza JSON')
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as { ccr?: { data?: RawSession[] }; data?: RawSession[] }
  const list = parsed.ccr?.data ?? parsed.data ?? []

  return list
    .filter(raw => typeof raw.id === 'string')
    .map(raw => {
      const group = groupOf(raw)
      const updatedAt = Date.parse(raw.updated_at ?? '')

      return {
        id: raw.id as string,
        title: raw.title !== undefined && raw.title !== '' ? raw.title : '(senza titolo)',
        group,
        detail: detailOf(raw, group),
        updatedAt: Number.isNaN(updatedAt) ? 0 : updatedAt,
        isUnread: raw.unread === true,
        isThis: raw.id === thisId,
      }
    })
}

export function ago(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000))
  if (minutes < 1) {
    return 'ora'
  }
  if (minutes < 60) {
    return `${minutes} min fa`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours} h fa`
  }

  return `${Math.round(hours / 24)} g fa`
}

export const GROUPS: readonly { group: ChatGroup; title: string; limit: number }[] = [
  { group: 'waiting', title: '🔴 Aspettano una tua risposta', limit: 20 },
  { group: 'failed', title: '⚠️ Si sono bloccate per un errore', limit: 10 },
  { group: 'working', title: '🟢 Stanno lavorando', limit: 20 },
  { group: 'review', title: '🟡 Pronte da rivedere', limit: 10 },
  { group: 'done', title: '✓ Finite di recente', limit: 5 },
]

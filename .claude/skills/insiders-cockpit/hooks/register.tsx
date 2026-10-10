import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatList, ChatRow, LastTurn, Stats } from '../types'
import { GROUPS, ago, parseSessions } from './chats'

const CHAT = 'cockpit-chat'
const SESSIONS = 'cockpit-sessions'
const REMOTE = 'claude-code-remote'

const stats = atom({ plugin: 'insiders-cockpit', key: 'stats' } as const, null)
const last = atom({ plugin: 'insiders-cockpit', key: 'last' } as const, null)
const isBusy = atom({ plugin: 'insiders-cockpit', key: 'isBusy' } as const, false)
const isBandHidden = atom({ plugin: 'insiders-cockpit', key: 'isBandHidden' } as const, false)
const chats = atom({ plugin: 'insiders-cockpit', key: 'chats' } as const, null)

// Pulsanti che avviano una conversazione con un prompt già pronto.
const QUICK = [
  { key: 'q-briefing', label: 'Briefing di oggi', text: 'Fammi il briefing di oggi: priorità, scadenze e cosa devo fare per primo.' },
  { key: 'q-next', label: 'Cosa faccio ora?', text: 'Guardando quello che stiamo facendo, qual è la prossima cosa più utile da fare adesso?' },
  { key: 'q-recap', label: 'Riassumi la chat', text: 'Riassumi in 5 punti cosa abbiamo fatto finora in questa conversazione e cosa resta aperto.' },
  { key: 'q-idea', label: 'Dammi un parere', text: 'Dammi il tuo parere sincero su quello che stiamo facendo: cosa miglioreresti?' },
] as const

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString('it-IT', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Rome',
    })
  } catch {
    const d = new Date(ms)
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
  }
}

async function readBranch($: EngineInterface): Promise<string | null> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5000 })
    const branch = stdout.trim()

    return exitCode === 0 && branch !== '' ? branch : null
  } catch {
    return null
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const [usage, turns, branch, now] = await Promise.all([
    $.session.usage(),
    $.session.turns(),
    readBranch($),
    $.clock.now(),
  ])
  const fiveHour = usage.rateLimits.find(limit => limit.kind === 'five_hour')
  const next: Stats = {
    time: formatTime(now),
    contextPercent: usage.context.percent ?? null,
    costUsd: usage.cost?.usd ?? null,
    fiveHourPercent: fiveHour?.percentUsed ?? null,
    turns,
    branch,
  }
  await update($, stats, () => next)

  const parts = [
    next.contextPercent === null ? null : `ctx ${next.contextPercent}%`,
    next.costUsd === null ? null : `$${next.costUsd.toFixed(2)}`,
  ].filter(part => part !== null)
  $.ui.status(parts.length > 0 ? parts.join(' · ') : undefined)
}

// L'id cloud di questa sessione (cse_…) è lo stesso di session_… in list_sessions.
async function thisSessionId($: EngineInterface): Promise<string | null> {
  const remote = await $.env.get('CLAUDE_CODE_REMOTE_SESSION_ID')

  return remote === undefined ? null : remote.replace(/^cse_/, 'session_')
}

async function refreshChats($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const before = await read($, chats)
  let next: ChatList
  try {
    const result = await $.mcp.call(REMOTE, 'list_sessions', { mine: true, limit: 30 })
    const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')
    if (result.isError) {
      throw new Error(text.slice(0, 200))
    }
    next = { rows: parseSessions(text, await thisSessionId($)), checkedAt: now, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    next = { rows: before?.rows ?? [], checkedAt: before?.checkedAt ?? now, error: message.slice(0, 200) }
  }
  await update($, chats, () => next)

  // Avvisa quando una chat inizia ad aspettare una tua risposta.
  if (before !== null && next.error === null) {
    const wasWaiting = new Set(before.rows.filter(row => row.group === 'waiting').map(row => row.id))
    const fresh = next.rows.filter(row => row.group === 'waiting' && !row.isThis && !wasWaiting.has(row.id))
    for (const row of fresh) {
      $.ui.toast(`🔴 "${row.title}" aspetta una tua risposta`)
    }
  }
}

async function send($: EngineInterface, text: string): Promise<void> {
  const trimmed = text.trim()
  if (trimmed === '') {
    return
  }
  await update($, isBusy, () => true)
  await $.prompt.submit({ text: trimmed, asUser: true })
}

function openChat($: EngineInterface) {
  return $.ui.open({ id: CHAT, title: 'Chat con Claude', focus: true })
}

async function openSessions($: EngineInterface) {
  const opened = await $.ui.open({ id: SESSIONS, title: 'Le mie chat' })
  await refreshChats($)

  return opened
}

function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function sessionUrl(row: ChatRow): string {
  return `https://claude.ai/code/${row.id}`
}

export const register: Register = on => {
  let startedAt = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chat',
      description: 'Apre il pannello Chat con Claude (pulsanti rapidi + campo di testo)',
    })
    await $.command.register({
      name: 'chats',
      description: 'Apre "Le mie chat": quali aspettano una risposta, quali lavorano, quali sono da rivedere',
    })
    await $.command.register({
      name: 'cockpit',
      description: 'Mostra di nuovo la barra dati sopra il prompt',
    })
    $.clock.every(30_000, () => {
      void refresh($)
    })
    $.clock.every(60_000, () => {
      void refreshChats($)
    })
    void refresh($)
    void refreshChats($)

    return next(e)
  })

  on('command.run', { command: 'chat' }, async $ => {
    await openChat($)

    return { text: 'Pannello chat aperto.' }
  })

  on('command.run', { command: 'chats' }, async $ => {
    await openSessions($)

    return { text: 'Pannello "Le mie chat" aperto.' }
  })

  on('command.run', { command: 'cockpit' }, async $ => {
    await update($, isBandHidden, () => false)
    await refresh($)

    return { text: 'Barra dati visibile.' }
  })

  on('prompt.submit', async ($, e, next) => {
    startedAt = await $.clock.now()
    await update($, isBusy, () => true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const seconds = startedAt > 0 ? Math.round(((await $.clock.now()) - startedAt) / 1000) : Math.round(e.durationMs / 1000)
      const turn: LastTurn = { seconds, answer: e.answer }
      await update($, last, () => turn)
      await update($, isBusy, () => false)
      void refresh($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: CHAT }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const turn = await read($, last)
    const busy = await read($, isBusy)
    // Mobile non ha il campo di testo: lì restano i pulsanti rapidi.
    let input = null
    if (e.surface !== 'mobile') {
      const { Input } = $.ui.resolve(e)
      input = (
        <Input
          key="chat-input"
          placeholder="Scrivi a Claude e premi Invio…"
          submitLabel="invia"
          onSubmit={value => {
            void send($, value)
          }}
        />
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Avvia una conversazione</Text>
        <Box flexDirection="row" flexWrap="wrap">
          {QUICK.map(item => (
            <Button key={item.key} label={item.label} onPress={() => send($, item.text)} />
          ))}
        </Box>
        {input}
        <Text> </Text>
        {busy ? (
          <Text dimColor>Claude sta rispondendo…</Text>
        ) : turn === null ? (
          <Text dimColor>Nessuna risposta ancora. Premi un pulsante o scrivi qui sopra.</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>Ultima risposta ({turn.seconds}s):</Text>
            <Markdown text={short(turn.answer === '' ? '(nessun testo)' : turn.answer, 4000)} />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SESSIONS }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const list = await read($, chats)
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns - 4)

    if (list === null) {
      return <Text dimColor>Carico le tue chat…</Text>
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Aggiornato {ago(list.checkedAt, now)} </Text>
          <Button key="chats-refresh" label="Aggiorna" onPress={() => refreshChats($)} />
        </Box>
        {list.error !== null && <Text color="red">Non riesco a leggere le chat: {list.error}</Text>}
        {GROUPS.map(({ group, title, limit }) => {
          const rows = list.rows.filter(row => row.group === group).slice(0, limit)
          if (rows.length === 0) {
            return null
          }

          return (
            <Box key={`g-${group}`} flexDirection="column" marginTop={1}>
              <Text bold>
                {title} ({rows.length})
              </Text>
              {rows.map(row => (
                <Box key={`r-${row.id}`} flexDirection="column">
                  <Box flexDirection="row">
                    <Text>{row.isUnread ? '● ' : '  '}</Text>
                    {row.isThis ? (
                      <Text bold>{short(row.title, width - 20)} (questa)</Text>
                    ) : (
                      <Link href={sessionUrl(row)} label={short(row.title, width - 20)} />
                    )}
                    <Text dimColor> · {ago(row.updatedAt, now)}</Text>
                  </Box>
                  {row.detail !== '' && <Text dimColor>    {short(row.detail, width)}</Text>}
                </Box>
              ))}
            </Box>
          )
        })}
        {list.rows.length === 0 && list.error === null && <Text dimColor>Nessuna chat trovata.</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hidden = await read($, isBandHidden)
    const current = await read($, stats)
    if (e.props.hasSurvey || hidden || current === null) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const turn = await read($, last)
    const busy = await read($, isBusy)
    const list = await read($, chats)
    const others = (list?.rows ?? []).filter(row => !row.isThis)
    const waiting = others.filter(row => row.group === 'waiting' || row.group === 'failed').length
    const working = others.filter(row => row.group === 'working').length

    const items = [
      `🕒 ${current.time}`,
      current.contextPercent === null ? null : `Contesto ${current.contextPercent}%`,
      current.costUsd === null ? null : `Costo $${current.costUsd.toFixed(2)}`,
      current.fiveHourPercent === null ? null : `Limite 5h ${current.fiveHourPercent}%`,
      `Turni ${current.turns}`,
      busy ? 'In corso…' : turn === null ? null : `Ultimo ${turn.seconds}s`,
      current.branch === null ? null : `⎇ ${current.branch}`,
    ].filter(item => item !== null)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap">
          <Button key="open-chats" variant={waiting > 0 ? 'primary' : 'secondary'} onPress={() => openSessions($)}>
            {waiting > 0 ? `🔴 ${waiting} aspettano te` : '✓ nessuna ti aspetta'}
            {` · 🟢 ${working} al lavoro`}
          </Button>
          <Button key="open-chat" label="Chat" onPress={() => openChat($)} />
          <Button key="refresh" label="Aggiorna" onPress={() => Promise.all([refresh($), refreshChats($)])} />
          <Button key="hide" label="Nascondi" onPress={() => update($, isBandHidden, () => true)} />
        </Box>
        <Text dimColor={(current.contextPercent ?? 0) < 70} color={(current.contextPercent ?? 0) >= 85 ? 'red' : undefined}>
          {items.join('  ·  ')}
        </Text>
      </Box>
    )
  })
}

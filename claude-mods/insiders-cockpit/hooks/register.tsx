import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LastTurn, Stats } from '../types'

const CHAT = 'cockpit-chat'

const stats = atom({ plugin: 'insiders-cockpit', key: 'stats' } as const, null)
const last = atom({ plugin: 'insiders-cockpit', key: 'last' } as const, null)
const isBusy = atom({ plugin: 'insiders-cockpit', key: 'isBusy' } as const, false)
const isBandHidden = atom({ plugin: 'insiders-cockpit', key: 'isBandHidden' } as const, false)

// Pulsanti che avviano una conversazione con un prompt già pronto.
const QUICK = [
  { key: 'q-briefing', label: 'Briefing di oggi', text: 'Fammi il briefing di oggi: priorità, scadenze e cosa devo fare per primo.' },
  { key: 'q-next', label: 'Cosa faccio ora?', text: 'Guardando quello che stiamo facendo, qual è la prossima cosa più utile da fare adesso?' },
  { key: 'q-recap', label: 'Riassumi la chat', text: 'Riassumi in 5 punti cosa abbiamo fatto finora in questa conversazione e cosa resta aperto.' },
  { key: 'q-idea', label: 'Dammi un parere', text: 'Dammi il tuo parere sincero su quello che stiamo facendo: cosa miglioreresti?' },
] as const

const CHAT_TITLE = 'Chat con Claude'

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

async function send($: EngineInterface, text: string): Promise<void> {
  const trimmed = text.trim()
  if (trimmed === '') {
    return
  }
  await update($, isBusy, () => true)
  await $.prompt.submit({ text: trimmed, asUser: true })
}

function openChat($: EngineInterface) {
  return $.ui.open({ id: CHAT, title: CHAT_TITLE, focus: true })
}

function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export const register: Register = on => {
  let startedAt = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'chat',
      description: 'Apre il pannello Chat con Claude (pulsanti rapidi + campo di testo)',
    })
    await $.command.register({
      name: 'cockpit',
      description: 'Mostra di nuovo la barra dati sopra il prompt',
    })
    $.clock.every(30_000, () => {
      void refresh($)
    })
    void refresh($)

    return next(e)
  })

  on('command.run', { command: 'chat' }, async $ => {
    await openChat($)

    return { text: 'Pannello chat aperto.' }
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hidden = await read($, isBandHidden)
    const current = await read($, stats)
    if (e.props.hasSurvey || hidden || current === null) {
      return next(e)
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const turn = await read($, last)
    const busy = await read($, isBusy)

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
      <Box flexDirection="row" flexWrap="wrap">
        <Text dimColor={(current.contextPercent ?? 0) < 70} color={(current.contextPercent ?? 0) >= 85 ? 'red' : undefined}>
          {items.join('  ·  ')}{'  '}
        </Text>
        <Button key="open-chat" label="Chat" variant="primary" onPress={() => openChat($)} />
        <Button key="refresh" label="Aggiorna" onPress={() => refresh($)} />
        <Button key="hide" label="Nascondi" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })
}

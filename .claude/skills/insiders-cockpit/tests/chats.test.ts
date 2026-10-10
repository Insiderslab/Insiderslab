import { expect, mock, test } from 'claude-code/testing'

import { parseSessions } from '../hooks/chats'

const LIST = {
  ccr: {
    data: [
      {
        id: 'session_A',
        title: 'Struttura Heili',
        status_bucket: 'SESSION_STATUS_BUCKET_BLOCKED',
        updated_at: '2026-10-10T17:56:33Z',
        unread: true,
        post_turn_summary: { status_category: 'need_input', needs_action: 'Approva Claude_Docs — Batch' },
      },
      {
        id: 'session_B',
        title: 'Griglie novembre',
        status_bucket: 'SESSION_STATUS_BUCKET_WORKING',
        updated_at: '2026-10-10T17:50:00Z',
        task_summary: 'scrivo la griglia di Tre Rooms',
      },
      { id: 'session_C', title: 'Tre Rooms sito', status_bucket: 'SESSION_STATUS_BUCKET_REVIEW_READY', updated_at: '2026-10-10T00:37:22Z' },
      { id: 'session_ME', title: 'Modifica pannello', status_bucket: 'SESSION_STATUS_BUCKET_WORKING', updated_at: '2026-10-10T18:00:00Z' },
    ],
  },
}

const WRAPPED = `<other-session nonce="x">\nheader\n${JSON.stringify(LIST)}\n</other-session nonce="x">`

test('le chat finiscono nel gruppo giusto', () => {
  const rows = parseSessions(WRAPPED, 'session_ME')
  expect(rows.map(row => [row.id, row.group])).toEqual([
    ['session_A', 'waiting'],
    ['session_B', 'working'],
    ['session_C', 'review'],
    ['session_ME', 'working'],
  ])
  expect(rows[0]?.detail).toBe('Approva Claude_Docs — Batch')
  expect(rows[1]?.detail).toBe('scrivo la griglia di Tre Rooms')
  expect(rows[3]?.isThis).toBe(true)
})

test('il pannello mostra chi aspetta e la barra le conta', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-10T18:00:00Z') })
  on('env.get', () => ({ value: 'cse_ME' }))
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: WRAPPED }], isError: false } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 10 }, rateLimits: [] } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.turns', () => ({ value: 1 }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  // /chats apre il pannello e legge l'elenco.
  await $.command.run({ command: 'chats', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
  await $.command.run({ command: 'cockpit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'insiders-cockpit',
      surface,
      component: 'Pane',
      requestId: 'cockpit-sessions',
      props: { title: 'Le mie chat', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: /Aspettano una tua risposta \(1\)/ })).toBeDefined()
    expect(await pane.find({ type: 'Link', text: /Struttura Heili/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Modifica pannello.*\(questa\)/ })).toBeDefined()
    await pane.unmount()

    const band = await $.ui.mount({
      plugin: 'insiders-cockpit',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 140, scroll: { offset: 0, bodyRows: 4 }, view: {} },
    })
    expect((await band.find({ key: 'open-chats' }))?.text).toContain('1 aspettano te')
    expect((await band.find({ key: 'open-chats' }))?.text).toContain('1 al lavoro')
    await band.unmount()
  }
})

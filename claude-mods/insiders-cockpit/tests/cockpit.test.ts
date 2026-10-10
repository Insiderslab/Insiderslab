import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'cockpit-chat',
  props: {
    title: 'Chat con Claude',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

test('un pulsante rapido avvia una conversazione', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'insiders-cockpit', surface, ...PANE })
    expect(await ui.find({ key: 'q-briefing' })).toBeDefined()
    await ui.press({ key: 'q-briefing' })
    await ui.unmount()
  }

  expect(sent.length).toBe(2)
  expect(sent[0]).toContain('briefing')
})

test('il campo di testo invia quello che scrivi', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  const ui = await $.ui.mount({ plugin: 'insiders-cockpit', surface: 'desktop', ...PANE })
  await ui.input({ key: 'chat-input', text: 'ciao Claude' })
  await ui.unmount()

  expect(sent).toEqual(['ciao Claude'])
})

test('la barra dati compare dopo /cockpit', async ($, on) => {
  mock.clock(on)
  on('session.usage', () => ({ value: {
    startedAt: 0,
    context: { tokens: 24000, window: 200000, percent: 12 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 34 }],
    cost: { usd: 0.84 },
  } }))
  on('session.turns', () => ({ value: 6 }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.command.run({
    command: 'cockpit',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'insiders-cockpit', surface, ...BAND })
    expect(await ui.find({ key: 'open-chat' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Contesto 12%/ }))?.text).toContain('Costo $0.84')
    await ui.unmount()
  }
})

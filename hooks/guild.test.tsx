import { expect, test } from 'claude-code/testing'

import { levelOf, spellFor, xpForLevel } from './game'

const PANE = {
  plugin: 'guild-hall',
  component: 'Pane',
  requestId: 'guild-hall',
  props: {
    title: 'Guild Hall',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('levels follow the curve', async () => {
  expect(levelOf(0).level).toBe(1)
  expect(levelOf(xpForLevel(1)).level).toBe(2)
  expect(levelOf(xpForLevel(1) - 1).level).toBe(1)
  expect(spellFor('Read').name).toBe('Scry Scroll')
  expect(spellFor('mcp__Slack__slack_send_message').name).toBe('Send Raven')
})

test('tasks become quests, clearing one earns XP, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'guild' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: '7', subject: 'Slay the flaky test' } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Slay the flaky test', description: 'x' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Slay the flaky test/ }))?.text).toContain('Slay the flaky test')
    expect((await ui.find({ type: 'Text', text: /ACTIVE/ }))?.text).toContain('ACTIVE')
    expect((await ui.find({ type: 'Text', text: /Golem/ }))?.text).toContain("Golem's Command")
    await ui.unmount()
  }

  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' })
  // classic.TaskCompleted for the same task must not pay twice
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /CLEARED/ }))?.text).toContain('CLEARED')
  expect((await ui.find({ type: 'Text', text: /Quests cleared/ }))?.text).toContain('Quests cleared 1')
  await ui.unmount()
})

test('the armory lists locked themes', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'armory' })
  expect((await ui.find({ type: 'Text', text: /Frost Citadel/ }))?.text).toContain('Frost Citadel')
  expect((await ui.find({ type: 'Text', text: /Lv 8/ }))?.text).toContain('Lv 8')
  await ui.unmount()
})

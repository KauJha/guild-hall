import { expect, mock, test } from 'claude-code/testing'

import { levelOf, normalizeVault, rollRelic, spellFor, unlocksAt, xpForLevel } from './game'
import { githubQuery, parseGithub } from './sweep'

const PANE = {
  plugin: 'guild-hall',
  component: 'Pane',
  requestId: 'guild-hall',
  props: {
    title: 'Guild Hall',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

// A 0.1 save: everything here must survive the upgrade.
const OLD_HERO = {
  name: 'Sir Testalot',
  xp: 4271,
  questsCleared: 0,
  spellsCast: 3614,
  turns: 219,
  theme: 'forge',
  isNarrating: false,
  isSoundOn: false,
}

// Synthetic connector answers in the shapes the real ones use.
const jiraPage = (issues: Array<{ key: string; summary: string; status: string; type: string; cat?: string }>) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        issues: {
          nodes: issues.map(i => ({
            key: i.key,
            webUrl: `https://example.invalid/browse/${i.key}`,
            fields: {
              summary: i.summary,
              status: { name: i.status, statusCategory: { key: i.cat ?? 'indeterminate' } },
              issuetype: { name: i.type },
              priority: { name: 'Medium' },
              updated: '2026-11-01T10:00:00.000-0400',
            },
          })),
        },
      }),
    },
  ],
  isError: false,
})

test('rules: levels, unlocks at every level, relics are stable', async () => {
  expect(levelOf(0).level).toBe(1)
  expect(levelOf(xpForLevel(1)).level).toBe(2)
  for (let l = 2; l <= 20; l++) expect(unlocksAt(l).length).toBeGreaterThan(0)
  expect(rollRelic('jira:ABC-1')?.id).toBe(rollRelic('jira:ABC-1')?.id)
  expect(spellFor('mcp__Slack__slack_send_message').name).toBe('Send Raven')
  expect(normalizeVault(undefined).baselined.jira).toBe(false)
  expect(githubQuery('2026-10-01')).toContain('review-requested:@me')
  const gh = parseGithub({ data: { mine: { nodes: [{ url: 'u1', title: 'T', number: 3, repository: { nameWithOwner: 'o/r' }, reviewDecision: 'APPROVED', commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } }] }, review: { nodes: [] }, merged: { nodes: [{ url: 'm1', title: 'M' }] }, reviewed: { nodes: [] } } })
  expect(gh.mine[0]?.checks).toBe('SUCCESS')
  expect(gh.merged.length).toBe(1)
})

test('an existing 0.1 hero keeps every point of progress', async ($, on) => {
  mock.store(on, { hero: OLD_HERO })
  mock.clock(on, { now: Date.parse('2026-11-05T12:00:00Z') })
  on('command.register', () => ({ value: { command: 'guild' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.list', () => ({ value: [] }))
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: 'not connected' }], isError: true } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'not found' } }) as never)
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/x' })

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Sir Testalot/ }))?.text).toContain('Sir Testalot')
    expect((await ui.find({ type: 'Text', text: /Level [67]/ }))?.text).toMatch(/Level [67]/)
    await ui.unmount()
  }
})

test('sweeps post Jira quests and PR bounties, and pay only for new work', async ($, on) => {
  mock.store(on, { hero: OLD_HERO })
  const clock = mock.clock(on, { now: Date.parse('2026-11-05T12:00:00Z') })
  let isDone = false
  on('command.register', () => ({ value: { command: 'x' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.list', () => ({ value: [{ name: 'mcp__claude_ai_Atlassian_Rovo__searchJiraIssuesUsingJql', description: '', mcp: true }] }))
  on('mcp.call', (_, e) => {
    if (e.tool === 'getAccessibleAtlassianResources') {
      return { value: { content: [{ type: 'text', text: JSON.stringify([{ id: 'site-1', scopes: ['read:jira-work'] }]) }], isError: false } }
    }
    const jql = String(e.args.jql)
    if (jql.includes('statusCategory = Done')) {
      return { value: jiraPage(isDone ? [{ key: 'GH-1', summary: 'Old', status: 'Done', type: 'Task', cat: 'done' }, { key: 'GH-2', summary: 'Slay the flaky test', status: 'Done', type: 'Bug', cat: 'done' }] : [{ key: 'GH-1', summary: 'Old', status: 'Done', type: 'Task', cat: 'done' }]) }
    }

    return { value: jiraPage(isDone ? [] : [{ key: 'GH-2', summary: 'Slay the flaky test', status: 'In Progress', type: 'Bug' }]) }
  })
  on('process.run', (_, e): never => {
    if (e.argv.includes('--version')) return { value: { exitCode: 0, stdout: 'gh version 2', stderr: '' } } as never

    return {
      value: {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({ data: { mine: { nodes: [] }, review: { nodes: [{ url: 'https://example.invalid/pr/9', title: 'Add dragon', number: 9, repository: { nameWithOwner: 'guild/keep' }, updatedAt: '2026-11-04T10:00:00Z' }] }, merged: { nodes: [] }, reviewed: { nodes: [] } } }),
      },
    } as never
  })
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const first = await $.command.run({ command: 'sweep', args: '' } as never)
  expect(first.text).toContain('1 open quest')

  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-quests' })
  expect((await ui.find({ type: 'Text', text: /Slay the flaky test/ }))?.text).toContain('Slay the flaky test')
  expect((await ui.find({ type: 'Text', text: /Add dragon/ }))?.text).toContain('Add dragon')
  await ui.unmount()

  // The ticket gets resolved; the next sweep pays for it once, and GH-1 (old work) never.
  isDone = true
  await clock.advance(60_000)
  const second = await $.command.run({ command: 'sweep', args: '' } as never)
  expect(second.text).toContain('1 quest cleared (+80 XP)')
  const third = await $.command.run({ command: 'sweep', args: '' } as never)
  expect(third.text).not.toContain('cleared')

  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-hall' })
  expect((await ui.find({ type: 'Text', text: /since tracking began/ }))?.text).toContain('1 tickets resolved')
  await ui.unmount()
})

test('the armory and treasury draw', async ($, on) => {
  mock.store(on, { hero: OLD_HERO })
  mock.clock(on, { now: Date.parse('2026-11-05T12:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-armory' })
  expect((await ui.find({ type: 'Text', text: /Frost Citadel/ }))?.text).toContain('Frost Citadel')
  await ui.press({ key: 'tab-treasury' })
  expect((await ui.find({ type: 'Text', text: /Achievements/ }))?.text).toContain('Achievements')
  await ui.unmount()
})

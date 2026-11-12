import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Celebration, Hero, PullRequest, Quest, QuestStatus, Rarity, Spell, Vault, View } from '../types'
import { hallSvg, relicSvg, swatchSvg } from './art'
import {
  ACHIEVEMENTS,
  COSMETICS,
  NEW_HERO,
  NEW_VAULT,
  RELICS,
  THEMES,
  XP,
  ago,
  bar,
  dayOf,
  isBountyStatus,
  isCursed,
  isNextDay,
  jiraXp,
  levelOf,
  normalizeHero,
  normalizeVault,
  rankOf,
  relicById,
  rollRelic,
  spellFor,
  themeById,
  titleFor,
  unlocksAt,
  wornFor,
} from './game'
import type { Slot } from './game'
import { sweepGithub, sweepJira } from './sweep'

const PANE = 'guild-hall'
const TITLE = 'Guild Hall'
const AUTO_SWEEP_MS = 30 * 60 * 1000

const NEW_BOARD: Board = { quests: [], mine: [], toReview: [], sweptAt: 0, jiraNote: '', githubNote: '', isSweeping: false }

// The hero keeps its 0.1 shape tag: progress carries straight over.
const hero = atom({ plugin: 'guild-hall', key: 'hero' } as const, NEW_HERO, { shape: 'hero-1' })
const quests = atom({ plugin: 'guild-hall', key: 'quests' } as const, [] as Quest[], { shape: 'quests-1' })
const spells = atom({ plugin: 'guild-hall', key: 'spells' } as const, [] as Spell[], { shape: 'spells-1' })
const board = atom({ plugin: 'guild-hall', key: 'board' } as const, NEW_BOARD, { shape: 'board-1' })
const vault = atom({ plugin: 'guild-hall', key: 'vault' } as const, NEW_VAULT, { shape: 'vault-1' })
const view = atom({ plugin: 'guild-hall', key: 'view' } as const, 'hall' as View)
const isBandHidden = atom({ plugin: 'guild-hall', key: 'isBandHidden' } as const, false)
const celebration = atom({ plugin: 'guild-hall', key: 'celebration' } as const, null as Celebration | null)

type Engine = EngineInterface

const RARITY_COLOR: Record<Rarity, string> = { common: 'inactive', rare: 'suggestion', epic: 'merged', legendary: 'warning' }

// ---------- persistence ----------

let isReady = false
let readying: Promise<void> | null = null
let isSweeping = false
let autoTimer: { cancel: () => void } | null = null

/** Loads saved progress once per load. Every write waits for it, so nothing can overwrite saved progress with a blank hero. */
function ensureReady($: Engine): Promise<void> {
  if (isReady) return Promise.resolve()
  readying ??= (async () => {
    const savedHero = await $.store.get('hero')
    if (savedHero !== undefined) {
      // A one-time copy of the 0.1 save, before this version writes anything.
      if ((await $.store.get('hero-backup-0.1')) === undefined) await $.store.set('hero-backup-0.1', savedHero)
      await update($, hero, () => normalizeHero(savedHero))
    }
    const savedVault = await $.store.get('vault')
    if (savedVault !== undefined) await update($, vault, () => normalizeVault(savedVault))
    const savedBoard = await $.store.get('board')
    if (savedBoard && typeof savedBoard === 'object') await update($, board, () => ({ ...NEW_BOARD, ...(savedBoard as Board), isSweeping: false }))
    for (const [name, description] of [
      ['guild', 'Open the Guild Hall'],
      ['sweep', 'Sweep the realm: refresh Jira quests and GitHub bounties'],
    ] as const) {
      try {
        await $.command.register({ name, description })
      } catch {
        // already registered
      }
    }
    isReady = true
  })().finally(() => {
    readying = null
  })

  return readying
}

async function changeHero($: Engine, fn: (me: Hero) => Hero): Promise<{ before: Hero; after: Hero }> {
  await ensureReady($)
  let before: Hero = NEW_HERO
  let after: Hero = NEW_HERO
  await update($, hero, current => {
    before = current ?? NEW_HERO
    after = fn(before)

    return after
  })
  await $.store.set('hero', after)

  return { before, after }
}

async function changeVault($: Engine, fn: (v: Vault) => Vault): Promise<Vault> {
  await ensureReady($)
  let after: Vault = NEW_VAULT
  await update($, vault, current => (after = fn(current ?? NEW_VAULT)))
  await $.store.set('vault', after)

  return after
}

const playSound = ($: Engine, me: Hero, asset: string) => {
  if (me.isSoundOn) void $.audio.play({ asset }).catch(() => undefined)
}

async function logDeed($: Engine, text: string, xp: number) {
  const at = await $.clock.now()
  await changeVault($, v => ({ ...v, deeds: [...v.deeds, { at, text, xp }].slice(-40) }))
}

// ---------- XP, levels, rewards ----------

async function grant($: Engine, xp: number, patch: (me: Hero) => Partial<Hero> = () => ({})) {
  const { before, after } = await changeHero($, me => ({ ...me, ...patch(me), xp: me.xp + xp }))
  const from = levelOf(before.xp).level
  const to = levelOf(after.xp).level
  if (to <= from) return
  const unlocked: string[] = []
  let chest = 0
  for (let lvl = from + 1; lvl <= to; lvl++) {
    const got = unlocksAt(lvl)
    unlocked.push(...got)
    if (got.some(g => g.includes('bonus XP chest'))) chest += lvl * 10
  }
  const at = await $.clock.now()
  await update($, celebration, () => ({ level: to, unlocked, at }))
  $.ui.toast(`✨ LEVEL ${to}! ${titleFor(to)}. Unlocked: ${unlocked.join(', ')}`)
  playSound($, after, 'sounds/levelup.wav')
  await logDeed($, `Reached level ${to}`, 0)
  if (chest > 0) await grant($, chest)
}

async function checkAchievements($: Engine) {
  const me = await read($, hero)
  const v = await read($, vault)
  const fresh = ACHIEVEMENTS.filter(a => !v.achievements.includes(a.id) && a.check(me, v))
  if (fresh.length === 0) return
  await changeVault($, x => ({ ...x, achievements: [...x.achievements, ...fresh.map(a => a.id)] }))
  for (const a of fresh) {
    $.ui.toast(`🏆 Achievement: ${a.name} (+${a.xp} XP)`)
    await logDeed($, `Achievement: ${a.name}`, a.xp)
    await grant($, a.xp)
  }
}

/** The first activity of each day pays a boon that grows with the streak. */
async function checkDay($: Engine) {
  const today = dayOf(await $.clock.now())
  const v = await read($, vault)
  if (v.streak.last === today) return
  const days = isNextDay(v.streak.last, today) ? v.streak.days + 1 : 1
  await changeVault($, x => ({ ...x, streak: { days, last: today } }))
  const boon = XP.dailyBoon * Math.min(days, 7)
  await logDeed($, `Daily boon, ${days}-day streak`, boon)
  await grant($, boon)
  if (days > 1) $.ui.toast(`🔥 ${days}-day streak! Daily boon +${boon} XP`)
}

// ---------- side quests (Claude's own task list) ----------

async function postQuest($: Engine, id: string, subject: string) {
  let isNew = false
  await update($, quests, list => {
    const current = list ?? []
    isNew = !current.some(q => q.id === id)

    return isNew ? [...current, { id, subject, status: 'pending' as QuestStatus }].slice(-40) : current
  })
  if (isNew) await grant($, XP.questAccepted)
}

async function moveQuest($: Engine, id: string, status: QuestStatus, subject?: string) {
  let isCleared = false
  let name = subject ?? `Side quest #${id}`
  await update($, quests, list => {
    const current = list ?? []
    const found = current.find(q => q.id === id)
    isCleared = status === 'completed' && found?.status !== 'completed'
    name = subject ?? found?.subject ?? name
    if (!found) return [...current, { id, subject: name, status }].slice(-40)

    return current.map(q => (q.id === id ? { ...q, status, subject: subject ?? q.subject } : q))
  })
  if (isCleared) {
    await grant($, XP.questCleared, me => ({ questsCleared: me.questsCleared + 1 }))
    $.ui.toast(`📜 Side quest done: ${name} (+${XP.questCleared} XP)`)
  }
}

// ---------- the sweep ----------

async function sweep($: Engine): Promise<string> {
  if (isSweeping) return 'A sweep is already under way.'
  isSweeping = true
  try {
    await ensureReady($)
    await update($, board, b => ({ ...(b ?? NEW_BOARD), isSweeping: true }))
    const now = await $.clock.now()
    const [jira, gh] = await Promise.all([sweepJira($), sweepGithub($, now)])

    let snapshot: Board = NEW_BOARD
    await update($, board, b => {
      const prev = b ?? NEW_BOARD
      snapshot = {
        quests: jira.ok ? jira.quests : prev.quests,
        mine: gh.ok ? gh.mine : prev.mine,
        toReview: gh.ok ? gh.toReview : prev.toReview,
        sweptAt: now,
        jiraNote: jira.note,
        githubNote: gh.note,
        isSweeping: false,
      }

      return snapshot
    })
    await $.store.set('board', snapshot)

    // Credit what got done since the last sweep. The first successful sweep of each source
    // only records what is already done, so old work is not paid twice.
    const v = await read($, vault)
    const isFirstJira = jira.ok && !v.baselined.jira
    const isFirstGithub = gh.ok && !v.baselined.github
    const newJira = jira.ok && !isFirstJira ? jira.done.filter(d => !v.credited.jira.includes(d.key)) : []
    const newPrs = gh.ok && !isFirstGithub ? gh.merged.filter(p => !v.credited.prs.includes(p.url)) : []
    const newReviews = gh.ok && !isFirstGithub ? gh.reviewed.filter(p => !v.credited.reviews.includes(p.url)) : []

    const found: string[] = []
    const relics: { id: string; at: number }[] = []
    const roll = (seed: string, chance: number) => {
      const r = rollRelic(seed, chance)
      if (r) {
        relics.push({ id: r.id, at: now })
        found.push(`${r.name} (${r.rarity})`)
      }
    }
    let xp = 0
    for (const d of newJira) {
      xp += jiraXp(d.type)
      roll(`jira:${d.key}`, 0.6)
    }
    for (const p of newPrs) {
      xp += XP.prMerged
      roll(`pr:${p.url}`, 0.5)
    }
    for (const p of newReviews) {
      xp += XP.review
      roll(`review:${p.url}`, 0.3)
    }

    await changeVault($, x => ({
      ...x,
      baselined: { jira: x.baselined.jira || jira.ok, github: x.baselined.github || gh.ok },
      credited: {
        jira: jira.ok ? [...new Set([...x.credited.jira, ...jira.done.map(d => d.key)])].slice(-2000) : x.credited.jira,
        prs: gh.ok ? [...new Set([...x.credited.prs, ...gh.merged.map(p => p.url)])].slice(-2000) : x.credited.prs,
        reviews: gh.ok ? [...new Set([...x.credited.reviews, ...gh.reviewed.map(p => p.url)])].slice(-2000) : x.credited.reviews,
      },
      tallies: {
        jira: x.tallies.jira + newJira.length,
        bugs: x.tallies.bugs + newJira.filter(d => d.type.toLowerCase() === 'bug').length,
        prs: x.tallies.prs + newPrs.length,
        reviews: x.tallies.reviews + newReviews.length,
      },
      relics: [...x.relics, ...relics].slice(-500),
      deeds: [
        ...x.deeds,
        ...newJira.map(d => ({ at: now, text: `Cleared ${d.key} (${d.type || 'ticket'})`, xp: jiraXp(d.type) })),
        ...newPrs.map(p => ({ at: now, text: `PR merged: ${p.title.slice(0, 60)}`, xp: XP.prMerged })),
        ...newReviews.map(p => ({ at: now, text: `Reviewed: ${p.title.slice(0, 60)}`, xp: XP.review })),
        ...relics.map(r => ({ at: now, text: `Found ${relicById(r.id)?.name ?? 'a relic'}`, xp: 0 })),
      ].slice(-40),
    }))

    const me = await read($, hero)
    const parts: string[] = []
    if (newJira.length) parts.push(`${newJira.length} quest${newJira.length > 1 ? 's' : ''} cleared`)
    if (newPrs.length) parts.push(`${newPrs.length} PR${newPrs.length > 1 ? 's' : ''} merged`)
    if (newReviews.length) parts.push(`${newReviews.length} review${newReviews.length > 1 ? 's' : ''}`)
    if (xp > 0) {
      await grant($, xp)
      $.ui.toast(`⚔ Sweep: ${parts.join(', ')} (+${xp} XP)${found.length ? `. Loot: ${found.join(', ')}` : ''}`)
      playSound($, me, found.some(f => /legendary|epic/.test(f)) ? 'sounds/relic.wav' : 'sounds/quest.wav')
    }
    if (isFirstJira || isFirstGithub) {
      await logDeed($, 'The Chronicle is sealed: past deeds recorded, new ones now earn XP', 0)
    }
    await checkAchievements($)

    const open = snapshot.quests.length
    const summary = `Swept: ${open} open quest${open === 1 ? '' : 's'}, ${snapshot.toReview.length} to review, ${snapshot.mine.length} of your PRs open` + (parts.length ? `; ${parts.join(', ')} (+${xp} XP)` : '')
    const notes = [jira.note, gh.note].filter(Boolean)

    return notes.length ? `${summary}. ${notes.join(' ')}` : `${summary}.`
  } catch (e) {
    await update($, board, b => ({ ...(b ?? NEW_BOARD), isSweeping: false }))

    return `The sweep failed: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    isSweeping = false
  }
}

async function startAutoSweep($: Engine) {
  autoTimer?.cancel()
  autoTimer = null
  const v = await read($, vault)
  if (!v.isAutoSweep) return
  autoTimer = $.clock.every(AUTO_SWEEP_MS, () => void sweep($))
  const b = await read($, board)
  if ((await $.clock.now()) - b.sweptAt > 10 * 60 * 1000) void sweep($)
}

// ---------- drawing helpers ----------

const prStatus = (p: PullRequest) => {
  const parts: string[] = []
  if (p.isDraft) parts.push('draft')
  if (p.checks === 'SUCCESS') parts.push('✓ checks')
  else if (p.checks === 'FAILURE' || p.checks === 'ERROR') parts.push('✗ checks failing')
  else if (p.checks === 'PENDING' || p.checks === 'EXPECTED') parts.push('… checks running')
  if (p.review === 'APPROVED') parts.push('approved')
  else if (p.review === 'CHANGES_REQUESTED') parts.push('changes requested')
  else if (p.review === 'REVIEW_REQUIRED') parts.push('awaiting review')

  return parts.join(' · ')
}

const prColor = (p: PullRequest) =>
  p.checks === 'FAILURE' || p.checks === 'ERROR' || p.review === 'CHANGES_REQUESTED' ? 'error' : p.review === 'APPROVED' && p.checks === 'SUCCESS' ? 'success' : 'subtle'

const daysOld = (iso: string, now: number) => {
  const t = Date.parse(iso)

  return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : 0
}

// ---------- registration ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isReady = false
    await ensureReady($)
    void $.ui.open({ id: PANE, title: TITLE })
    void checkDay($).then(() => checkAchievements($))
    void startAutoSweep($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await ensureReady($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'guild' }, async $ => {
    await ensureReady($)
    await update($, isBandHidden, () => false)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return { text: 'The doors of the Guild Hall swing open.' }
  })

  on('command.run', { command: 'sweep' }, async $ => ({ text: await sweep($) }))

  // Every tool call is a spell; a successful one earns a little XP.
  on('tool.call', async ($, e, next) => {
    await ensureReady($)
    const tool = String(e.tool)
    const id = e.tool_use_id
    const spell = spellFor(tool)
    await update($, spells, list => [...(list ?? []), { id, tool, ...spell, state: 'casting' as const }].slice(-60))
    const ran = await next(e)
    const hasFailed = ran.deny !== undefined || ran.isError === true
    await update($, spells, list =>
      (list ?? []).map(s => (s.id === id ? { ...s, state: hasFailed ? ('failed' as const) : ('done' as const) } : s)),
    )
    if (!hasFailed) await grant($, XP.spell, me => ({ spellsCast: me.spellsCast + 1 }))

    return ran
  }).catch(($, e, next) => next(e))

  // Claude's own task lists become side quests.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = (ran.result as { task?: { id?: string; subject?: string } } | undefined)?.task
    if (ran.isError !== true && task?.id) await postQuest($, String(task.id), task.subject ?? e.subject)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && e.taskId) {
      if (e.status === 'deleted') await update($, quests, l => (l ?? []).filter(q => q.id !== e.taskId))
      else if (e.status) await moveQuest($, e.taskId, e.status, e.subject)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      for (const todo of e.todos) {
        const id = `todo:${todo.content.slice(0, 80)}`
        await postQuest($, id, todo.content)
        if (todo.status !== 'pending') await moveQuest($, id, todo.status)
      }
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'answer') {
      await grant($, XP.turn, me => ({ turns: me.turns + 1 }))
      await checkDay($)
      await checkAchievements($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // ---------- the band above the prompt ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const me = await read($, hero)
    const v = await read($, vault)
    const b = await read($, board)
    const info = levelOf(me.xp)
    const open = b.quests.filter(q => !isBountyStatus(q.status)).length
    const bounties = b.toReview.length

    return (
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <Text color="claude" weight="bold">
          ⚔ Lv {info.level} {titleFor(info.level)}
        </Text>
        <Text color="claude" mono>
          {bar(info.fraction)}
        </Text>
        <Text mono tabular>
          {info.into}/{info.needed} XP
        </Text>
        {v.streak.days > 1 && <Text color="warning">🔥 {v.streak.days}d</Text>}
        {b.sweptAt > 0 && (
          <Text color="inactive">
            · {open} quests · {bounties} to review
          </Text>
        )}
        <Button key="open" label="Hall" plain onPress={() => void $.ui.open({ id: PANE, title: TITLE, focus: true })} />
        <Button key="sweep" label={b.isSweeping ? 'Sweeping…' : 'Sweep'} plain onPress={() => void sweep($)} />
        <Button key="hide" label="Hide" plain dimColor onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  // ---------- the pane ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const Input = 'Input' in els ? els.Input : undefined
    const Link = 'Link' in els ? els.Link : undefined

    const me = await read($, hero)
    const v = await read($, vault)
    const b = await read($, board)
    const side = await read($, quests)
    const sp = await read($, spells)
    const current = await read($, view)
    const party = await read($, celebration)
    const now = await $.clock.now()
    const info = levelOf(me.xp)
    const t = themeById(me.theme, info.level)
    const worn = (slot: Slot) => wornFor(slot, v.equipped[slot], info.level)
    const width = Math.min(640, Math.max(240, (e.props.bodyColumns ?? 60) * 8))
    const jiraQuests = b.quests.filter(q => !isBountyStatus(q.status))
    const inReview = b.quests.filter(q => isBountyStatus(q.status))
    const uniqueRelics = new Set(v.relics.map(r => r.id))

    const heading = (label: string) => (
      <Text size="heading" weight="bold">
        {label}
      </Text>
    )
    const dim = (s: string) => <Text color="inactive">{s}</Text>

    const scene = Svg ? (
      <Svg
        source={hallSvg({
          theme: t,
          mode: v.scene,
          hat: worn('hat'),
          robe: worn('robe'),
          familiar: worn('familiar'),
          aura: worn('aura'),
          quests: jiraQuests.length,
          bounties: b.toReview.length,
          relics: v.relics.length,
          alt: `${me.name}, level ${info.level} ${titleFor(info.level)}, in the ${t.name}`,
        })}
        alt={`${me.name}, level ${info.level} ${titleFor(info.level)}`}
        width={width}
        isInteractive
      />
    ) : null

    const header = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Text size="title" weight="bold">
            {me.name}
          </Text>
          <Text color="claude" weight="semibold">
            Level {info.level} · {titleFor(info.level)}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text color="claude" mono>
            {bar(info.fraction, 20)}
          </Text>
          <Text mono tabular>
            {info.into} / {info.needed} XP
          </Text>
          {dim(`${info.needed - info.into} to level ${info.level + 1}`)}
        </Box>
        <Text color="inactive">
          {v.streak.days > 0 ? `🔥 ${v.streak.days}-day streak · ` : ''}
          {uniqueRelics.size}/{RELICS.length} relics · {v.achievements.length}/{ACHIEVEMENTS.length} achievements · {me.xp.toLocaleString()} XP total
        </Text>
      </Box>
    )

    const banner = party && now - party.at < 6 * 3600 * 1000 && (
      <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Text color="warning" weight="bold">
          ✨ Level {party.level} reached: {titleFor(party.level)}
        </Text>
        <Text>Unlocked: {party.unlocked.join(', ')}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="see-armory" label="See the Armory" onPress={() => update($, view, () => 'armory')} />
          <Button key="dismiss" label="Dismiss" dimColor onPress={() => update($, celebration, () => null)} />
        </Box>
      </Box>
    )

    const tabs = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {(
          [
            ['hall', 'Hall'],
            ['quests', `Quests (${jiraQuests.length + b.toReview.length})`],
            ['treasury', 'Treasury'],
            ['armory', 'Armory'],
          ] as const
        ).map(([id, label]) => (
          <Button key={`tab-${id}`} label={label} variant={current === id ? 'primary' : 'secondary'} onPress={() => update($, view, () => id)} />
        ))}
        <Button key="sweep" label={b.isSweeping ? 'Sweeping…' : '⟳ Sweep the realm'} onPress={() => void sweep($)} />
      </Box>
    )

    const swept = (
      <Text color="inactive">
        {b.isSweeping ? 'Sweeping the realm…' : b.sweptAt ? `Last swept ${ago(b.sweptAt, now)}${v.isAutoSweep ? ' · sweeps every 30 min' : ''}` : 'Not swept yet. Press Sweep the realm.'}
      </Text>
    )

    let body: unknown

    if (current === 'quests') {
      body = (
        <Box flexDirection="column" gap={1}>
          {swept}
          {b.jiraNote && <Text color="warning">{b.jiraNote}</Text>}
          {b.githubNote && <Text color="warning">{b.githubNote}</Text>}

          {heading(`📜 Quest Board (${jiraQuests.length})`)}
          {jiraQuests.length === 0 && dim(b.sweptAt ? 'No open Jira tickets assigned to you. The board is clear.' : 'Sweep to post your Jira tickets here.')}
          {jiraQuests.slice(0, 15).map(q => {
            const r = rankOf(q)
            const cursed = isCursed(q.status)
            const age = daysOld(q.updated, now)

            return (
              <Box key={`q-${q.key}`} flexDirection="column" borderStyle="round" borderColor={cursed ? 'error' : RARITY_COLOR[r.rarity]} paddingX={1}>
                <Box flexDirection="row" gap={1} justifyContent="space-between">
                  <Text weight="bold">{q.key}</Text>
                  {Link && q.url ? <Link href={q.url} label="Open ↗" /> : null}
                </Box>
                <Text>{q.summary}</Text>
                <Text color={cursed ? 'error' : 'inactive'}>
                  {r.label} · {cursed ? `Cursed (${q.status})` : q.status}
                  {age > 14 ? ` · 🕸 ${age}d untouched` : age > 0 ? ` · ${age}d ago` : ' · today'}
                </Text>
              </Box>
            )
          })}

          {heading(`⚔ Bounties: reviews asked of you (${b.toReview.length})`)}
          {b.toReview.length === 0 && dim(b.sweptAt ? 'Nobody is waiting on your review.' : 'Sweep to post review requests here.')}
          {b.toReview.slice(0, 12).map(p => (
            <Box key={`r-${p.url}`} flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
              <Box flexDirection="row" gap={1} justifyContent="space-between">
                <Text weight="bold">
                  {p.repo}#{p.number}
                </Text>
                {Link ? <Link href={p.url} label="Review ↗" /> : null}
              </Box>
              <Text>{p.title}</Text>
              <Text color="inactive">
                Bounty +{XP.review} XP · waiting {daysOld(p.updated, now)}d{p.isDraft ? ' · draft' : ''}
              </Text>
            </Box>
          ))}

          {heading(`🔨 Your pull requests (${b.mine.length})`)}
          {b.mine.length === 0 && dim(b.sweptAt ? 'No open PRs of yours.' : 'Sweep to list your open PRs.')}
          {b.mine.slice(0, 12).map(p => (
            <Box key={`m-${p.url}`} flexDirection="column" borderStyle="round" borderColor={prColor(p)} paddingX={1}>
              <Box flexDirection="row" gap={1} justifyContent="space-between">
                <Text weight="bold">
                  {p.repo}#{p.number}
                </Text>
                {Link ? <Link href={p.url} label="Open ↗" /> : null}
              </Box>
              <Text>{p.title}</Text>
              <Text color={prColor(p) === 'subtle' ? 'inactive' : prColor(p)}>{prStatus(p) || 'open'}</Text>
            </Box>
          ))}

          {inReview.length > 0 && heading(`⏳ Tickets in review (${inReview.length})`)}
          {inReview.slice(0, 10).map(q => (
            <Text key={`ir-${q.key}`}>
              <Text weight="bold">{q.key}</Text> {q.summary} <Text color="inactive">({q.status})</Text>
            </Text>
          ))}

          {side.length > 0 && heading("🧭 Side quests from Claude's task list")}
          {side.slice(-10).map(q => (
            <Text key={`s-${q.id}`} color={q.status === 'completed' ? 'inactive' : q.status === 'in_progress' ? 'claude' : undefined} strikethrough={q.status === 'completed'}>
              {q.status === 'completed' ? '✓' : q.status === 'in_progress' ? '⚔' : '◇'} {q.subject}
            </Text>
          ))}
        </Box>
      )
    } else if (current === 'treasury') {
      const counts = new Map<string, number>()
      for (const r of v.relics) counts.set(r.id, (counts.get(r.id) ?? 0) + 1)
      const order: Rarity[] = ['legendary', 'epic', 'rare', 'common']
      body = (
        <Box flexDirection="column" gap={1}>
          {heading(`💎 Relics (${uniqueRelics.size}/${RELICS.length})`)}
          {dim('Relics drop when you resolve tickets (60%), get PRs merged (50%) and review PRs (30%).')}
          {order.map(rarity => {
            const all = RELICS.filter(r => r.rarity === rarity)
            const got = all.filter(r => counts.has(r.id))

            return (
              <Box key={`rar-${rarity}`} flexDirection="column">
                <Text color={RARITY_COLOR[rarity]} weight="bold">
                  {rarity[0]?.toUpperCase()}
                  {rarity.slice(1)} · {got.length}/{all.length}
                </Text>
                {got.map(r => (
                  <Box key={`relic-${r.id}`} flexDirection="row" gap={1} alignItems="center">
                    {Svg && <Svg source={relicSvg(r.rarity, true)} alt={r.rarity} width={24} />}
                    <Text>
                      {r.name}
                      {(counts.get(r.id) ?? 0) > 1 ? ` ×${counts.get(r.id)}` : ''}
                    </Text>
                    <Text color="inactive" italic>
                      {r.lore}
                    </Text>
                  </Box>
                ))}
                {all.length > got.length && dim(`${all.length - got.length} still hidden`)}
              </Box>
            )
          })}
          {heading(`🏆 Achievements (${v.achievements.length}/${ACHIEVEMENTS.length})`)}
          {ACHIEVEMENTS.map(a => {
            const has = v.achievements.includes(a.id)

            return (
              <Text key={`ach-${a.id}`} color={has ? 'success' : 'inactive'}>
                {has ? '🏆' : '🔒'} {a.name} · {a.text} · +{a.xp} XP
              </Text>
            )
          })}
        </Box>
      )
    } else if (current === 'armory') {
      const slotRow = (slot: Slot, label: string) => {
        const all = COSMETICS.filter(c => c.slot === slot)
        const open = all.filter(c => c.unlockAt <= info.level)
        const next = all.find(c => c.unlockAt > info.level)
        const wearing = worn(slot)

        return (
          <Box key={`slot-${slot}`} flexDirection="column">
            <Text weight="bold">{label}</Text>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              {open.map(c => (
                <Button
                  key={`eq-${slot}-${c.id}`}
                  label={c.name}
                  variant={wearing === c.id ? 'primary' : 'secondary'}
                  onPress={() => changeVault($, x => ({ ...x, equipped: { ...x.equipped, [slot]: c.id } }))}
                />
              ))}
            </Box>
            {next && dim(`Next: ${next.name} at level ${next.unlockAt}`)}
          </Box>
        )
      }
      const toggle = (key: string, label: string, isOn: boolean, onPress: () => unknown) => (
        <Button key={key} label={`${label}: ${isOn ? 'on' : 'off'}`} variant={isOn ? 'primary' : 'secondary'} onPress={onPress} />
      )
      body = (
        <Box flexDirection="column" gap={1}>
          {heading('🛡 The Armory')}
          {Input && (
            <Input
              key="name"
              label="Hero name"
              placeholder="Your adventurer's name"
              value={me.name}
              submitLabel="Rename"
              onSubmit={value => changeHero($, x => ({ ...x, name: value.trim().slice(0, 24) || 'Adventurer' }))}
            />
          )}
          <Text weight="bold">Hall</Text>
          {THEMES.map(theme => {
            const isLocked = theme.unlockAt > info.level

            return (
              <Box key={`theme-${theme.id}`} flexDirection="row" gap={1} alignItems="center">
                {Svg && <Svg source={swatchSvg(theme, isLocked)} alt={theme.name} width={72} />}
                <Text color={isLocked ? 'inactive' : undefined}>{theme.name}</Text>
                {isLocked ? (
                  dim(`🔒 level ${theme.unlockAt}`)
                ) : theme.id === t.id ? (
                  <Text color="success">✓ In use</Text>
                ) : (
                  <Button key={`equip-${theme.id}`} label="Use" onPress={() => changeHero($, x => ({ ...x, theme: theme.id }))} />
                )}
              </Box>
            )
          })}
          {slotRow('hat', 'Hat')}
          {slotRow('robe', 'Robe')}
          {slotRow('familiar', 'Familiar')}
          {slotRow('aura', 'Aura')}
          <Text weight="bold">Time of day</Text>
          <Box flexDirection="row" gap={1}>
            {(
              [
                ['auto', 'Match the app'],
                ['day', 'Day'],
                ['night', 'Night'],
              ] as const
            ).map(([id, label]) => (
              <Button key={`scene-${id}`} label={label} variant={v.scene === id ? 'primary' : 'secondary'} onPress={() => changeVault($, x => ({ ...x, scene: id }))} />
            ))}
          </Box>
          <Text weight="bold">Settings</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {toggle('auto-sweep', 'Sweep every 30 min', v.isAutoSweep, async () => {
              await changeVault($, x => ({ ...x, isAutoSweep: !x.isAutoSweep }))
              await startAutoSweep($)
            })}
            {toggle('sound', 'Sound', me.isSoundOn, () => changeHero($, x => ({ ...x, isSoundOn: !x.isSoundOn })))}
          </Box>
        </Box>
      )
    } else {
      // The hall: what happened lately, and what's next.
      const tally = new Map<string, { n: number; school: string; failed: number }>()
      for (const s of sp.slice(-40)) {
        const x = tally.get(s.name) ?? { n: 0, school: s.school, failed: 0 }
        x.n += 1
        if (s.state === 'failed') x.failed += 1
        tally.set(s.name, x)
      }
      const casting = sp.filter(s => s.state === 'casting')
      const nextLevel = [1, 2, 3, 4, 5, 6].map(d => info.level + d).find(l => unlocksAt(l).length > 0)
      const deeds = [...v.deeds].reverse().slice(0, 10)
      const activeQuest = jiraQuests.find(q => /progress|doing|active/i.test(q.status) || q.category === 'indeterminate')
      body = (
        <Box flexDirection="column" gap={1}>
          {swept}
          {activeQuest && (
            <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
              <Text color="claude" weight="bold">
                ⚔ Current quest
              </Text>
              <Text>
                <Text weight="bold">{activeQuest.key}</Text> {activeQuest.summary}
              </Text>
            </Box>
          )}
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Text>📜 {jiraQuests.length} open quests</Text>
            <Text>⚔ {b.toReview.length} bounties</Text>
            <Text>🔨 {b.mine.length} PRs in the forge</Text>
          </Box>
          {nextLevel && (
            <Text color="inactive">
              Level {nextLevel} unlocks: {unlocksAt(nextLevel).join(', ')}
            </Text>
          )}
          {heading('🏰 Recent deeds')}
          {deeds.length === 0 && dim('Your deeds will be chronicled here: tickets cleared, PRs merged, relics found.')}
          {deeds.map((d, i) => (
            <Box key={`deed-${i}`} flexDirection="row" gap={1}>
              <Text color={d.xp > 0 ? 'success' : 'inactive'} mono tabular>
                {d.xp > 0 ? `+${String(d.xp).padStart(3)}` : '    '}
              </Text>
              <Text>{d.text}</Text>
              {dim(ago(d.at, now))}
            </Box>
          ))}
          {heading('✦ Spellbook')}
          {casting.length > 0 && <Text color="claude">✧ Casting {casting.map(s => s.name).join(', ')}…</Text>}
          {tally.size === 0 && dim('No spells cast yet this session.')}
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            {[...tally.entries()]
              .sort((a, c) => c[1].n - a[1].n)
              .slice(0, 8)
              .map(([name, x]) => (
                <Text key={`sp-${name}`} color={x.failed ? 'warning' : undefined}>
                  {name} ×{x.n}
                </Text>
              ))}
          </Box>
          {dim(`${me.spellsCast.toLocaleString()} spells cast · ${me.turns.toLocaleString()} turns · ${v.tallies.jira} tickets resolved · ${v.tallies.prs} PRs merged · ${v.tallies.reviews} reviews since tracking began`)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {scene}
        {header}
        {banner}
        {tabs}
        {body as never}
      </Box>
    )
  })
}

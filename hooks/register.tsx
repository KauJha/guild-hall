import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Celebration, Contract, DeedKind, Focus, Fx, Hero, Mood, PullRequest, Quest, QuestStatus, Rarity, Spell, Vault, View } from '../types'
import { bossSvg, hallSvg, relicSvg, swatchSvg } from './art'
import {
  ACHIEVEMENTS,
  BOSSES,
  CHEST_REWARD,
  COSMETICS,
  CONTRACT_REWARD,
  DAMAGE,
  GOLD,
  NEW_HERO,
  NEW_VAULT,
  RELICS,
  THEMES,
  XP,
  ago,
  bar,
  chronicleText,
  dayOf,
  isBountyStatus,
  isCursed,
  jiraXp,
  levelOf,
  newBoss,
  normalizeHero,
  normalizeVault,
  phaseAt,
  pickContracts,
  rankOf,
  relicById,
  rollBossRelic,
  rollRelic,
  seasonAt,
  spellFor,
  stepStreak,
  themeById,
  titleFor,
  unlocksAt,
  weekOf,
  wornFor,
} from './game'
import type { Slot } from './game'
import { sweepGithub, sweepJira } from './sweep'

// ======================= the realm: state and actions =======================

type Engine = EngineInterface

const PANE = 'guild-hall'
const TITLE = 'Guild Hall'
const AUTO_SWEEP_MS = 30 * 60 * 1000
const IDLE_MS = 20 * 60 * 1000

const NEW_BOARD: Board = { quests: [], mine: [], toReview: [], sweptAt: 0, jiraNote: '', githubNote: '', isSweeping: false, alerts: [] }

// The hero keeps its 0.1 shape tag: progress carries straight over. Others moved on and
// re-read from the store, which every version reads through normalize*.
const hero = atom({ plugin: 'guild-hall', key: 'hero' } as const, NEW_HERO, { shape: 'hero-1' })
const quests = atom({ plugin: 'guild-hall', key: 'quests' } as const, [] as Quest[], { shape: 'quests-1' })
const spells = atom({ plugin: 'guild-hall', key: 'spells' } as const, [] as Spell[], { shape: 'spells-1' })
const board = atom({ plugin: 'guild-hall', key: 'board' } as const, NEW_BOARD, { shape: 'board-2' })
const vault = atom({ plugin: 'guild-hall', key: 'vault' } as const, NEW_VAULT, { shape: 'vault-2' })
const view = atom({ plugin: 'guild-hall', key: 'view' } as const, 'hall' as View)
const isBandHidden = atom({ plugin: 'guild-hall', key: 'isBandHidden' } as const, false)
const celebration = atom({ plugin: 'guild-hall', key: 'celebration' } as const, null as Celebration | null)
const mood = atom({ plugin: 'guild-hall', key: 'mood' } as const, null as Mood | null)
const focus = atom({ plugin: 'guild-hall', key: 'focus' } as const, null as Focus | null)
const fx = atom({ plugin: 'guild-hall', key: 'fx' } as const, null as Fx | null)
const tick = atom({ plugin: 'guild-hall', key: 'tick' } as const, 0)
const lastActive = atom({ plugin: 'guild-hall', key: 'lastActive' } as const, 0)

// ---------- loading and saving ----------

let isReady = false
let readying: Promise<void> | null = null
let minuteTimer: { cancel: () => void } | null = null

function resetForLoad() {
  isReady = false
  readying = null
}

/** Loads saved progress once per load. Every write waits for it, so nothing can overwrite saved progress with a blank hero. */
function ensureReady($: Engine): Promise<void> {
  if (isReady) return Promise.resolve()
  readying ??= (async () => {
    const savedHero = await $.store.get('hero')
    if (savedHero !== undefined) {
      if ((await $.store.get('hero-backup-0.1')) === undefined) await $.store.set('hero-backup-0.1', savedHero)
      await update($, hero, () => normalizeHero(savedHero))
    }
    const savedVault = await $.store.get('vault')
    if (savedVault !== undefined) {
      if ((await $.store.get('vault-backup-0.2')) === undefined) await $.store.set('vault-backup-0.2', savedVault)
      await update($, vault, () => normalizeVault(savedVault))
    }
    const savedBoard = await $.store.get('board')
    if (savedBoard && typeof savedBoard === 'object') {
      await update($, board, () => ({ ...NEW_BOARD, ...(savedBoard as Board), alerts: Array.isArray((savedBoard as Board).alerts) ? (savedBoard as Board).alerts : [], isSweeping: false }))
    }
    const savedFocus = (await $.store.get('focus')) as Focus | null | undefined
    if (savedFocus && typeof savedFocus.endsAt === 'number') await update($, focus, () => savedFocus)
    for (const [name, description] of [
      ['guild', 'Open the Guild Hall'],
      ['sweep', 'Sweep the realm: refresh Jira quests and GitHub bounties'],
      ['focus', 'Start a focus session: /focus 25, or /focus stop'],
    ] as const) {
      try {
        await $.command.register({ name, description })
      } catch {
        // already registered
      }
    }
    isReady = true
    const startedAt = await $.clock.now()
    await update($, lastActive, () => startedAt)
    armFocus($)
    minuteTimer?.cancel()
    minuteTimer = $.clock.every(60_000, () => void everyMinute($)) as unknown as { cancel: () => void }
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

// ---------- feedback (quiet in calm mode) ----------

async function say($: Engine, text: string) {
  const v = await read($, vault)
  if (!v.isCalm) $.ui.toast(text)
}

async function sound($: Engine, asset: string) {
  const [me, v] = [await read($, hero), await read($, vault)]
  if (me.isSoundOn && !v.isCalm) void $.audio.play({ asset }).catch(() => undefined)
}

const moodTimer: { t: { cancel: () => void } | null } = { t: null }

async function setMood($: Engine, kind: Mood['kind'], line: string, ttlMs = 120_000) {
  const at = await $.clock.now()
  await update($, mood, () => ({ kind, line, at }))
  moodTimer.t?.cancel()
  if (kind !== 'sleep') moodTimer.t = $.clock.after(ttlMs, () => void update($, mood, m => (m && m.at === at ? null : m)))
}

async function flash($: Engine, payout: number, fireworks: boolean) {
  if ((await read($, vault)).isCalm) return
  const at = await $.clock.now()
  await update($, fx, () => ({ payout, fireworks, at }))
  $.clock.after(fireworks ? 90_000 : 8000, () => void update($, fx, f => (f && f.at === at ? null : f)))
}

async function logDeed($: Engine, text: string, xp: number, kind: DeedKind = 'other') {
  const at = await $.clock.now()
  await changeVault($, v => ({ ...v, deeds: [...v.deeds, { at, text, xp, kind }].slice(-300) }))
}

// ---------- XP, gold, levels ----------

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
  await update($, celebration, () => ({ level: to, unlocked, at, kind: 'level' as const }))
  await say($, `✨ LEVEL ${to}! ${titleFor(to)}. Unlocked: ${unlocked.join(', ')}`)
  await sound($, 'sounds/levelup.wav')
  await setMood($, 'cheer', `Level ${to}!`)
  await logDeed($, `Reached level ${to}`, 0, 'level')
  await flash($, 0, true)
  if (chest > 0) await grant($, chest)
}

/** Activity XP (tool calls, turns) shares a small daily cap: outcomes level you, not busywork. */
async function grantActivity($: Engine, xp: number, patch: (me: Hero) => Partial<Hero>) {
  const today = dayOf(await $.clock.now())
  let allowed = 0
  await changeVault($, v => {
    const used = v.activity.day === today ? v.activity.xp : 0
    allowed = Math.max(0, Math.min(xp, XP.activityCap - used))

    return { ...v, activity: { day: today, xp: used + allowed } }
  })
  await grant($, allowed, patch)
}

async function addGold($: Engine, n: number) {
  if (n > 0) await changeVault($, v => ({ ...v, gold: v.gold + n }))
}

async function checkAchievements($: Engine) {
  const me = await read($, hero)
  const v = await read($, vault)
  const fresh = ACHIEVEMENTS.filter(a => !v.achievements.includes(a.id) && a.check(me, v))
  if (fresh.length === 0) return
  await changeVault($, x => ({ ...x, achievements: [...x.achievements, ...fresh.map(a => a.id)] }))
  for (const a of fresh) {
    await say($, `🏆 Achievement: ${a.name} (+${a.xp} XP)`)
    await logDeed($, `Achievement: ${a.name}`, a.xp, 'achievement')
    await grant($, a.xp)
  }
}

// ---------- streaks ----------

async function checkDay($: Engine) {
  const now = await $.clock.now()
  const today = dayOf(now)
  const v = await read($, vault)
  if (v.streak.last === today) return
  const s = stepStreak(v.streak, today)
  await changeVault($, x => ({ ...x, streak: { days: s.days, last: today, shields: s.shields, best: s.best, lifetime: s.lifetime } }))
  await logDeed($, `Daily boon: ${s.days}-day streak${s.usedShields ? `, ${s.usedShields} shield${s.usedShields > 1 ? 's' : ''} used` : ''}`, s.boon, 'streak')
  await grant($, s.boon)
  await addGold($, GOLD.boon)
  if (s.usedShields) await say($, `🛡 A streak shield covered your missed day. Streak: ${s.days} days.`)
  else if (s.isStepDown) await say($, `Welcome back! Your streak stepped down to ${s.days} rather than resetting. Daily boon +${s.boon} XP`)
  else if (s.days > 1) await say($, `🔥 ${s.days}-day streak! Daily boon +${s.boon} XP${s.days % 5 === 0 ? ' and a new shield 🛡' : ''}`)
  await ensureContracts($)
}

// ---------- weekly boss ----------

async function dealDamage($: Engine, dmg: number, text: string) {
  const v = await read($, vault)
  const b = v.boss
  if (!b || b.isDefeated || dmg <= 0) return
  const at = await $.clock.now()
  const hp = Math.max(0, b.hp - dmg)
  const isDefeated = hp === 0
  await changeVault($, x => (x.boss ? { ...x, boss: { ...x.boss, hp, isDefeated, hits: [...x.boss.hits, { at, text, dmg }].slice(-30) } } : x))
  if (!isDefeated) return
  const relic = rollBossRelic(`${b.week}:${b.id}`)
  await changeVault($, x => ({ ...x, relics: [...x.relics, { id: relic.id, at }].slice(-500), tallies: { ...x.tallies, bosses: x.tallies.bosses + 1 } }))
  await addGold($, GOLD.boss)
  const me = await read($, hero)
  await update($, celebration, () => ({ level: levelOf(me.xp).level, unlocked: [`${relic.name} (${relic.rarity})`, `${GOLD.boss} gold`, '300 XP'], at, kind: 'boss' as const }))
  await flash($, 0, true)
  await say($, `⚔ ${b.name} is defeated! Spoils: ${relic.name} (${relic.rarity}), ${GOLD.boss} gold, 300 XP`)
  await sound($, 'sounds/boss.wav')
  await setMood($, 'cheer', 'Victory!')
  await logDeed($, `Defeated ${b.name}`, 300, 'boss')
  await grant($, 300)
  await checkAchievements($)
}

async function ensureBoss($: Engine, openQuests: number) {
  const week = weekOf(await $.clock.now())
  const v = await read($, vault)
  if (v.boss?.week === week) return
  const boss = newBoss(week, openQuests)
  await changeVault($, x => ({ ...x, boss }))
  const def = BOSSES.find(d => d.id === boss.id)
  await say($, `👹 A new boss looms: ${boss.name}. "${def?.taunt ?? ''}" Finish work this week to defeat it.`)
}

// ---------- daily contracts ----------

async function ensureContracts($: Engine) {
  const now = await $.clock.now()
  const today = dayOf(now)
  const v = await read($, vault)
  if (v.contracts?.day === today) return
  const b = await read($, board)
  const list = pickContracts(today, b, now)
  await changeVault($, x => ({ ...x, contracts: { day: today, list, isChestOpened: false } }))
}

/** Moves contracts of `kind` along; `hits` says which targets were met (empty: any). */
async function progressContract($: Engine, kind: Contract['kind'], amount = 1, hits: string[] = []) {
  const v = await read($, vault)
  const c = v.contracts
  if (!c) return
  const finished: Contract[] = []
  const list = c.list.map(k => {
    if (k.kind !== kind || k.isDone) return k
    if (k.targets.length && hits.length === 0) return k
    if (k.targets.length && !hits.some(target => k.targets.includes(target))) return k
    const progress = Math.min(k.goal, k.progress + amount)
    const done = progress >= k.goal
    if (done) finished.push(k)

    return { ...k, progress, isDone: done }
  })
  if (finished.length === 0 && list.every((k, i) => k.progress === c.list[i]?.progress)) return
  const allDone = list.every(k => k.isDone)
  const openChest = allDone && !c.isChestOpened
  await changeVault($, x => ({ ...x, contracts: x.contracts ? { ...x.contracts, list, isChestOpened: x.contracts.isChestOpened || openChest } : null, tallies: { ...x.tallies, contracts: x.tallies.contracts + finished.length } }))
  for (const k of finished) {
    await say($, `📋 Contract done: ${k.text} (+${CONTRACT_REWARD.xp} XP, +${CONTRACT_REWARD.gold} gold)`)
    await logDeed($, `Contract: ${k.text}`, CONTRACT_REWARD.xp, 'contract')
    await grant($, CONTRACT_REWARD.xp)
    await addGold($, CONTRACT_REWARD.gold)
    await dealDamage($, DAMAGE.contract, `Contract: ${k.text}`)
  }
  if (openChest) {
    const now = await $.clock.now()
    const relic = rollRelic(`chest:${c.day}`, 1)
    if (relic) await changeVault($, x => ({ ...x, relics: [...x.relics, { id: relic.id, at: now }].slice(-500) }))
    await addGold($, CHEST_REWARD.gold)
    await say($, `🎁 All three contracts done! The chest holds ${relic ? relic.name : 'gold'} and ${CHEST_REWARD.gold} gold.`)
    await sound($, 'sounds/relic.wav')
    await logDeed($, `Opened the daily chest${relic ? `: ${relic.name}` : ''}`, 0, 'relic')
  }
  if (finished.length) await checkAchievements($)
}

// ---------- side quests (Claude's own task list) ----------

async function postQuest($: Engine, id: string, subject: string) {
  let isNew = false
  await update($, quests, list => {
    const current = list ?? []
    isNew = !current.some(q => q.id === id)

    return isNew ? [...current, { id, subject, status: 'pending' as QuestStatus }].slice(-40) : current
  })
  if (isNew) await grantActivity($, XP.questAccepted, () => ({}))
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
    await progressContract($, 'side')
  }
}

// ---------- spells, batched so the pane redraws calmly ----------

const pending: { starts: Spell[]; ends: Map<string, boolean>; timer: { cancel: () => void } | null } = { starts: [], ends: new Map(), timer: null }

function spellStarted($: Engine, id: string, tool: string) {
  pending.starts.push({ id, tool, ...spellFor(tool), state: 'casting' })
  scheduleFlush($)
}

function spellEnded($: Engine, id: string, hasFailed: boolean) {
  pending.ends.set(id, hasFailed)
  scheduleFlush($)
}

function scheduleFlush($: Engine) {
  if (pending.timer) return
  pending.timer = $.clock.after(1500, () => void flushSpells($))
}

async function flushSpells($: Engine) {
  pending.timer = null
  const starts = pending.starts.splice(0)
  const ends = new Map(pending.ends)
  pending.ends.clear()
  if (starts.length === 0 && ends.size === 0) return
  await update($, spells, list =>
    [...(list ?? []), ...starts]
      .map(s => (ends.has(s.id) ? { ...s, state: ends.get(s.id) ? ('failed' as const) : ('done' as const) } : s))
      .slice(-60),
  )
  const ok = [...ends.values()].filter(f => !f).length
  if (ok > 0) await grantActivity($, ok * XP.spell, me => ({ spellsCast: me.spellsCast + ok }))
  await markActive($)
}

async function markActive($: Engine) {
  const now = await $.clock.now()
  await update($, lastActive, () => now)
  const m = await read($, mood)
  if (m?.kind === 'sleep') await update($, mood, () => null)
}

async function turnDone($: Engine) {
  await grantActivity($, XP.turn, me => ({ turns: me.turns + 1 }))
  await checkDay($)
  await checkAchievements($)
}

// ---------- every minute: focus countdown, naps, the Friday chronicle ----------

async function everyMinute($: Engine) {
  const now = await $.clock.now()
  if (await read($, focus)) await update($, tick, () => now)
  const last = await read($, lastActive)
  const m = await read($, mood)
  if (!m && last > 0 && now - last > IDLE_MS) await setMood($, 'sleep', '')
  const d = new Date(now)
  if (d.getDay() === 5 && d.getHours() >= 14) {
    const v = await read($, vault)
    const today = dayOf(now)
    if (v.chronicleNudged !== today) {
      await changeVault($, x => ({ ...x, chronicleNudged: today }))
      await say($, '📖 Your weekly chronicle is ready: /guild, then Chronicle, then Copy weekly update.')
    }
  }
}

// ---------- focus ----------

let focusTimer: { cancel: () => void } | null = null

function armFocus($: Engine) {
  focusTimer?.cancel()
  focusTimer = null
  void (async () => {
    const f = await read($, focus)
    if (!f) return
    const left = f.endsAt - (await $.clock.now())
    focusTimer = $.clock.after(Math.max(0, left), () => void finishFocus($))
  })()
}

async function startFocus($: Engine, minutes: number): Promise<string> {
  await ensureReady($)
  const m = Math.max(5, Math.min(120, Math.round(minutes) || 25))
  const startAt = await $.clock.now()
  const f = { startAt, endsAt: startAt + m * 60_000, minutes: m }
  await update($, focus, () => f)
  await update($, tick, () => startAt)
  await $.store.set('focus', f)
  armFocus($)
  await setMood($, 'curious', 'Shh… focusing', 30_000)

  return `🕯 Focus for ${m} minutes. The candle is lit.`
}

async function stopFocus($: Engine): Promise<string> {
  focusTimer?.cancel()
  focusTimer = null
  const f = await read($, focus)
  await update($, focus, () => null)
  await $.store.set('focus', null)

  return f ? 'The candle is snuffed. No penalty: come back to it anytime.' : 'No focus session is running.'
}

async function finishFocus($: Engine) {
  const f = await read($, focus)
  if (!f) return
  await update($, focus, () => null)
  await $.store.set('focus', null)
  const xp = Math.max(5, Math.round((XP.focus * f.minutes) / 25))
  await changeVault($, v => ({ ...v, tallies: { ...v.tallies, focus: v.tallies.focus + 1 } }))
  await logDeed($, `Focused for ${f.minutes} minutes`, xp, 'focus')
  await grant($, xp)
  await addGold($, GOLD.focus)
  await say($, `🕯 Focus complete: ${f.minutes} minutes (+${xp} XP). Stretch your legs, adventurer.`)
  await sound($, 'sounds/focus.wav')
  await setMood($, 'proud', 'Well focused!')
  await dealDamage($, DAMAGE.focus, `Focused ${f.minutes} min`)
  await progressContract($, 'focus')
  await checkAchievements($)
}

// ---------- the market ----------

async function buy($: Engine, id: string) {
  const v = await read($, vault)
  const r = v.shop.find(x => x.id === id)
  if (!r) return
  if (v.gold < r.cost) {
    $.ui.toast(`You need ${r.cost - v.gold} more gold for ${r.name}.`)

    return
  }
  const at = await $.clock.now()
  await changeVault($, x => ({ ...x, gold: x.gold - r.cost, purchases: [...x.purchases, { id: r.id, name: r.name, at }].slice(-30) }))
  $.ui.toast(`🛍 Bought: ${r.name}. Enjoy it, you earned it.`)
  await sound($, 'sounds/chest.wav')
}

async function addReward($: Engine, raw: string) {
  const m = raw.match(/^(.*?)[,|:]\s*(\d+)\s*$/)
  const name = (m?.[1] ?? raw).trim().slice(0, 40)
  const cost = Math.max(1, Math.min(10000, Number(m?.[2] ?? 50)))
  if (!name) return
  const id = `r${Date.now().toString(36)}`
  await changeVault($, x => ({ ...x, shop: [...x.shop, { id, name, cost }].slice(0, 20) }))
}

// ---------- the sweep ----------

let isSweeping = false
let autoTimer: { cancel: () => void } | null = null

async function startAutoSweep($: Engine) {
  autoTimer?.cancel()
  autoTimer = null
  const v = await read($, vault)
  if (!v.isAutoSweep) return
  autoTimer = $.clock.every(AUTO_SWEEP_MS, () => void sweep($)) as unknown as { cancel: () => void }
  const b = await read($, board)
  if ((await $.clock.now()) - b.sweptAt > 10 * 60 * 1000) void sweep($)
}

const short = (p: PullRequest) => `${p.repo.split('/').pop() ?? p.repo}#${p.number}`

/** What changed since the last sweep that needs you. */
function alertsFor(prev: Board, next: Board, now: number, nagged: Record<string, string>, today: string): { alerts: string[]; nagged: Record<string, string>; ciFailed: boolean; approved: boolean } {
  const alerts: string[] = []
  const was = (list: PullRequest[], url: string) => list.find(p => p.url === url)
  let ciFailed = false
  let approved = false
  if (prev.sweptAt > 0) {
    for (const p of next.toReview) if (!was(prev.toReview, p.url)) alerts.push(`New review request: ${short(p)} ${p.title}`)
    for (const p of next.mine) {
      const old = was(prev.mine, p.url)
      if (!old) continue
      if (p.review === 'APPROVED' && old.review !== 'APPROVED') {
        alerts.push(`Approved: ${short(p)} ${p.title}`)
        approved = true
      }
      if (p.review === 'CHANGES_REQUESTED' && old.review !== 'CHANGES_REQUESTED') alerts.push(`Changes requested: ${short(p)} ${p.title}`)
      if ((p.checks === 'FAILURE' || p.checks === 'ERROR') && old.checks !== p.checks) {
        alerts.push(`CI failed: ${short(p)} ${p.title}`)
        ciFailed = true
      }
    }
    const keys = new Set(prev.quests.map(q => q.key))
    for (const q of next.quests) if (!keys.has(q.key)) alerts.push(`New quest assigned: ${q.key} ${q.summary}`)
  }
  const out = { ...nagged }
  for (const p of next.toReview) {
    const t = Date.parse(p.updated)
    if (Number.isFinite(t) && now - t >= 2 * 86400000 && out[p.url] !== today) {
      alerts.push(`Waiting 2+ days on your review: ${short(p)} ${p.title}`)
      out[p.url] = today
    }
  }
  for (const k of Object.keys(out)) if (!next.toReview.some(p => p.url === k)) delete out[k]

  return { alerts, nagged: out, ciFailed, approved }
}

async function sweep($: Engine): Promise<string> {
  if (isSweeping) return 'A sweep is already under way.'
  isSweeping = true
  try {
    await ensureReady($)
    await update($, board, b => ({ ...(b ?? NEW_BOARD), isSweeping: true }))
    const now = await $.clock.now()
    const today = dayOf(now)
    const prev = await read($, board)
    const [jira, gh] = await Promise.all([sweepJira($), sweepGithub($, now)])

    const next: Board = {
      quests: jira.ok ? jira.quests : prev.quests,
      mine: gh.ok ? gh.mine : prev.mine,
      toReview: gh.ok ? gh.toReview : prev.toReview,
      sweptAt: now,
      jiraNote: jira.note,
      githubNote: gh.note,
      isSweeping: false,
      alerts: [],
    }
    const v0 = await read($, vault)
    const diff = alertsFor(prev, next, now, v0.nagged, today)
    next.alerts = diff.alerts.slice(0, 12)
    await update($, board, () => next)
    await $.store.set('board', next)

    await ensureBoss($, next.quests.length)
    await ensureContracts($)

    // Credit what got done since the last sweep. The first successful sweep of each source
    // only records what is already done, so old work is not paid twice.
    const v = await read($, vault)
    const isFirstJira = jira.ok && !v.baselined.jira
    const isFirstGithub = gh.ok && !v.baselined.github
    const newJira = jira.ok && !isFirstJira ? jira.done.filter(d => !v.credited.jira.includes(d.key)) : []
    const newPrs = gh.ok && !isFirstGithub ? gh.merged.filter(p => !v.credited.prs.includes(p.url)) : []
    const newReviews = gh.ok && !isFirstGithub ? gh.reviewed.filter(p => !v.credited.reviews.includes(p.url)) : []

    // Bonuses: reviews where the author had waited over a day; blocked tickets that got moving.
    const waited = (url: string) => {
      const p = prev.toReview.find(x => x.url === url)
      const t = p ? Date.parse(p.updated) : NaN

      return Number.isFinite(t) && now - t > 86400000
    }
    const wasCursed = prev.quests.filter(q => isCursed(q.status)).map(q => q.key)
    const unblocked = jira.ok ? wasCursed.filter(k => { const q = next.quests.find(x => x.key === k); return !q || !isCursed(q.status) }) : []

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
    let gold = 0
    const hits: { text: string; dmg: number }[] = []
    for (const d of newJira) {
      xp += jiraXp(d.type)
      gold += GOLD.jira
      hits.push({ text: `Cleared ${d.key}`, dmg: jiraXp(d.type) })
      roll(`jira:${d.key}`, 0.6)
    }
    for (const p of newPrs) {
      xp += XP.prMerged
      gold += GOLD.pr
      hits.push({ text: `Merged ${p.title.slice(0, 40)}`, dmg: DAMAGE.pr })
      roll(`pr:${p.url}`, 0.5)
    }
    for (const p of newReviews) {
      const bonus = waited(p.url) ? XP.reviewWaited : 0
      xp += XP.review + bonus
      gold += GOLD.review
      hits.push({ text: `Reviewed ${p.title.slice(0, 40)}`, dmg: DAMAGE.review })
      roll(`review:${p.url}`, 0.3)
    }
    for (const k of unblocked) {
      xp += XP.unblock
      hits.push({ text: `Lifted the curse on ${k}`, dmg: DAMAGE.unblock })
    }

    await changeVault($, x => ({
      ...x,
      nagged: diff.nagged,
      gold: x.gold + gold,
      baselined: { jira: x.baselined.jira || jira.ok, github: x.baselined.github || gh.ok },
      credited: {
        jira: jira.ok ? [...new Set([...x.credited.jira, ...jira.done.map(d => d.key)])].slice(-2000) : x.credited.jira,
        prs: gh.ok ? [...new Set([...x.credited.prs, ...gh.merged.map(p => p.url)])].slice(-2000) : x.credited.prs,
        reviews: gh.ok ? [...new Set([...x.credited.reviews, ...gh.reviewed.map(p => p.url)])].slice(-2000) : x.credited.reviews,
      },
      tallies: {
        ...x.tallies,
        jira: x.tallies.jira + newJira.length,
        bugs: x.tallies.bugs + newJira.filter(d => d.type.toLowerCase() === 'bug').length,
        prs: x.tallies.prs + newPrs.length,
        reviews: x.tallies.reviews + newReviews.length,
      },
      relics: [...x.relics, ...relics].slice(-500),
      deeds: [
        ...x.deeds,
        ...newJira.map(d => ({ at: now, text: `Cleared ${d.key} (${d.type || 'ticket'})`, xp: jiraXp(d.type), kind: 'jira' as const })),
        ...newPrs.map(p => ({ at: now, text: `PR merged: ${p.title.slice(0, 60)}`, xp: XP.prMerged, kind: 'pr' as const })),
        ...newReviews.map(p => ({ at: now, text: `Reviewed: ${p.title.slice(0, 60)}`, xp: XP.review + (waited(p.url) ? XP.reviewWaited : 0), kind: 'review' as const })),
        ...unblocked.map(k => ({ at: now, text: `Lifted the curse on ${k}`, xp: XP.unblock, kind: 'jira' as const })),
        ...relics.map(r => ({ at: now, text: `Found ${relicById(r.id)?.name ?? 'a relic'}`, xp: 0, kind: 'relic' as const })),
      ].slice(-300),
    }))

    const parts: string[] = []
    if (newJira.length) parts.push(`${newJira.length} quest${newJira.length > 1 ? 's' : ''} cleared`)
    if (newPrs.length) parts.push(`${newPrs.length} PR${newPrs.length > 1 ? 's' : ''} merged`)
    if (newReviews.length) parts.push(`${newReviews.length} review${newReviews.length > 1 ? 's' : ''}`)
    if (unblocked.length) parts.push(`${unblocked.length} curse${unblocked.length > 1 ? 's' : ''} lifted`)
    if (xp > 0) {
      await grant($, xp)
      await flash($, xp, false)
      await say($, `⚔ Sweep: ${parts.join(', ')} (+${xp} XP, +${gold} gold)${found.length ? `. Loot: ${found.join(', ')}` : ''}`)
      await sound($, found.some(f => /legendary|epic/.test(f)) ? 'sounds/relic.wav' : 'sounds/quest.wav')
    }
    for (const hit of hits) await dealDamage($, hit.dmg, hit.text)

    // Contracts
    if (newJira.length) await progressContract($, 'resolve', newJira.length)
    if (newPrs.length) await progressContract($, 'merge', newPrs.length)
    if (newReviews.length) {
      await progressContract($, 'review-any', newReviews.length)
      await progressContract($, 'review-stale', 1, newReviews.map(p => p.url))
    }
    // A stale review request that left your list counts too (you reviewed, or it was reassigned).
    const goneReviews = prev.toReview.filter(p => gh.ok && !next.toReview.some(x => x.url === p.url)).map(p => p.url)
    if (goneReviews.length) await progressContract($, 'review-stale', 1, goneReviews)
    if (unblocked.length) await progressContract($, 'unblock', 1, unblocked)
    const touched = jira.ok ? prev.quests.filter(q => { const n = next.quests.find(x => x.key === q.key); return !n || n.updated !== q.updated }).map(q => q.key) : []
    if (touched.length) await progressContract($, 'cobweb', 1, touched)
    const greened = gh.ok ? prev.mine.filter(p => (p.checks === 'FAILURE' || p.checks === 'ERROR') && (() => { const n = next.mine.find(x => x.url === p.url); return !n || n.checks === 'SUCCESS' })()).map(p => p.url) : []
    if (greened.length) await progressContract($, 'green', 1, greened)

    // Alerts and the familiar's reaction
    if (next.alerts.length) {
      await say($, next.alerts.length === 1 ? `🔔 ${next.alerts[0]}` : `🔔 ${next.alerts.length} things need you: ${next.alerts.slice(0, 2).join(' · ')}${next.alerts.length > 2 ? ' …' : ''}`)
      if (!xp) await sound($, 'sounds/alert.wav')
    }
    if (diff.ciFailed) await setMood($, 'alarm', 'CI is on fire!')
    else if (newPrs.length) await setMood($, 'cheer', 'Merged! Huzzah!')
    else if (diff.approved) await setMood($, 'proud', 'Approved!')
    else if (newJira.length) await setMood($, 'cheer', 'Quest complete!')
    else if (next.alerts.length) await setMood($, 'curious', 'A raven arrived…')

    if (isFirstJira || isFirstGithub) await logDeed($, 'The Chronicle is sealed: past deeds recorded, new ones now earn XP', 0)
    await checkAchievements($)

    const open = next.quests.length
    const summary = `Swept: ${open} open quest${open === 1 ? '' : 's'}, ${next.toReview.length} to review, ${next.mine.length} of your PRs open` + (parts.length ? `; ${parts.join(', ')} (+${xp} XP)` : '')
    const notes = [jira.note, gh.note].filter(Boolean)

    return notes.length ? `${summary}. ${notes.join(' ')}` : `${summary}.`
  } catch (e) {
    await update($, board, b => ({ ...(b ?? NEW_BOARD), isSweeping: false }))

    return `The sweep failed: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    isSweeping = false
  }
}

// ======================= hooks and drawing =======================

const RARITY_COLOR: Record<Rarity, string> = { common: 'inactive', rare: 'suggestion', epic: 'merged', legendary: 'warning' }

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

const mmss = (ms: number) => {
  const m = Math.max(0, Math.ceil(ms / 60000))

  return `${m}m`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    resetForLoad()
    await ensureReady($)
    void $.ui.open({ id: PANE, title: TITLE })
    void checkDay($).then(() => checkAchievements($))
    void startAutoSweep($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await ensureReady($)
    void markActive($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'guild' }, async $ => {
    await ensureReady($)
    await update($, isBandHidden, () => false)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return { text: 'The doors of the Guild Hall swing open.' }
  })

  on('command.run', { command: 'sweep' }, async $ => ({ text: await sweep($) }))

  on('command.run', { command: 'focus' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'stop' || arg === 'end' || arg === 'cancel') return { text: await stopFocus($) }

    return { text: await startFocus($, Number.parseInt(arg, 10) || 25) }
  })

  // Every tool call is a spell. Recorded in batches so the pane doesn't redraw on every call.
  on('tool.call', async ($, e, next) => {
    await ensureReady($)
    const id = e.tool_use_id
    spellStarted($, id, String(e.tool))
    const ran = await next(e)
    spellEnded($, id, ran.deny !== undefined || ran.isError === true)

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
    if (e.reason === 'answer') await turnDone($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // ---------- the band above the prompt ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const me = await read($, hero)
    const v = await read($, vault)
    const b = await read($, board)
    const f = await read($, focus)
    const now = f ? await read($, tick) : 0
    const info = levelOf(me.xp)
    const open = b.quests.filter(q => !isBountyStatus(q.status)).length
    const contracts = v.contracts?.list ?? []

    return (
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <Text color="claude" weight="bold">
          ⚔ Lv {info.level} {titleFor(info.level)}
        </Text>
        {!v.isCalm && (
          <Text color="claude" mono>
            {bar(info.fraction)}
          </Text>
        )}
        {!v.isCalm && (
          <Text mono tabular>
            {info.into}/{info.needed} XP
          </Text>
        )}
        {!v.isCalm && v.streak.days > 1 && (
          <Text color="warning">
            🔥{v.streak.days}
            {v.streak.shields ? ` 🛡${v.streak.shields}` : ''}
          </Text>
        )}
        {b.sweptAt > 0 && (
          <Text color="inactive">
            · {open} quests · {b.toReview.length} to review
            {!v.isCalm && contracts.length ? ` · 📋 ${contracts.filter(c => c.isDone).length}/${contracts.length}` : ''}
          </Text>
        )}
        {f && <Text color="claude">🕯 {mmss(f.endsAt - now)} left</Text>}
        {f && <Button key="stop-focus" label="Stop" plain dimColor onPress={() => void stopFocus($)} />}
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
    const m = await read($, mood)
    const f = await read($, focus)
    const effects = await read($, fx)
    const now = await $.clock.now()
    const info = levelOf(me.xp)
    const t = themeById(me.theme, info.level)
    const worn = (slot: Slot) => wornFor(slot, v.equipped[slot], info.level)
    // A fixed width and height keep the scene from collapsing and re-growing while it loads,
    // which is what made scrolling jump.
    const width = Math.round(Math.min(640, Math.max(240, (e.props.bodyColumns ?? 60) * 8)))
    const height = Math.round((width * 120) / 320)
    const jiraQuests = b.quests.filter(q => !isBountyStatus(q.status))
    const inReview = b.quests.filter(q => isBountyStatus(q.status))
    const uniqueRelics = new Set(v.relics.map(r => r.id))
    const calm = v.isCalm
    const mode = v.scene === 'clock' ? phaseAt(now) : v.scene

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
          mode,
          hat: worn('hat'),
          robe: worn('robe'),
          familiar: worn('familiar'),
          aura: worn('aura'),
          quests: jiraQuests.length,
          bounties: b.toReview.length,
          relics: v.relics.length,
          alt: `${me.name}, level ${info.level} ${titleFor(info.level)}, in the ${t.name}`,
          mood: m?.kind ?? null,
          line: m?.line ?? '',
          fireworks: !!effects?.fireworks,
          payout: effects?.payout ?? 0,
          focus: f ? { left: Math.max(1, Math.round((f.endsAt - now) / 1000)), total: f.minutes * 60 } : null,
          season: seasonAt(now),
        })}
        alt={`${me.name}, level ${info.level} ${titleFor(info.level)}`}
        width={width}
        height={height}
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
        {!calm && (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text color="claude" mono>
              {bar(info.fraction, 20)}
            </Text>
            <Text mono tabular>
              {info.into} / {info.needed} XP
            </Text>
            {dim(`${info.needed - info.into} to level ${info.level + 1}`)}
          </Box>
        )}
        {!calm && (
          <Text color="inactive">
            🪙 {v.gold} gold · 🔥 {v.streak.days}-day streak{v.streak.shields ? ` · 🛡 ${v.streak.shields}` : ''} · {v.streak.lifetime} days in the hall · {uniqueRelics.size}/{RELICS.length} relics · {v.achievements.length}/{ACHIEVEMENTS.length} achievements
          </Text>
        )}
      </Box>
    )

    const banner = !calm && party && now - party.at < 6 * 3600 * 1000 && (
      <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Text color="warning" weight="bold">
          {party.kind === 'boss' ? '⚔ Boss defeated!' : `✨ Level ${party.level} reached: ${titleFor(party.level)}`}
        </Text>
        <Text>
          {party.kind === 'boss' ? 'Spoils' : 'Unlocked'}: {party.unlocked.join(', ')}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="see-more" label={party.kind === 'boss' ? 'See the Treasury' : 'See the Armory'} onPress={() => update($, view, () => (party.kind === 'boss' ? 'treasury' : 'armory'))} />
          <Button key="dismiss" label="Dismiss" dimColor onPress={() => update($, celebration, () => null)} />
        </Box>
      </Box>
    )

    const TABS: ReadonlyArray<readonly [View, string]> = calm
      ? [
          ['hall', 'Hall'],
          ['quests', `Quests (${jiraQuests.length + b.toReview.length})`],
          ['armory', 'Armory'],
        ]
      : [
          ['hall', 'Hall'],
          ['quests', `Quests (${jiraQuests.length + b.toReview.length})`],
          ['chronicle', 'Chronicle'],
          ['treasury', 'Treasury'],
          ['market', `Market 🪙${v.gold}`],
          ['armory', 'Armory'],
        ]
    const tabs = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {TABS.map(([id, label]) => (
          <Button key={`tab-${id}`} label={label} variant={current === id ? 'primary' : 'secondary'} onPress={() => update($, view, () => id)} />
        ))}
        <Button key="sweep" label={b.isSweeping ? 'Sweeping…' : '⟳ Sweep'} onPress={() => void sweep($)} />
        {f ? (
          <Button key="focus-stop" label={`🕯 ${mmss(f.endsAt - now)} · Stop`} onPress={() => void stopFocus($)} />
        ) : (
          <Button key="focus-start" label="🕯 Focus 25" onPress={() => void startFocus($, 25)} />
        )}
      </Box>
    )

    const swept = (
      <Text color="inactive">
        {b.isSweeping ? 'Sweeping the realm…' : b.sweptAt ? `Last swept ${ago(b.sweptAt, now)}${v.isAutoSweep ? ' · sweeps every 30 min' : ''}` : 'Not swept yet. Press Sweep.'}
      </Text>
    )

    let body: unknown
    const tab = calm && !['hall', 'quests', 'armory'].includes(current) ? 'hall' : current

    if (tab === 'quests') {
      body = (
        <Box flexDirection="column" gap={1}>
          {swept}
          {b.jiraNote && <Text color="warning">{b.jiraNote}</Text>}
          {b.githubNote && <Text color="warning">{b.githubNote}</Text>}

          {heading(`⚔ Bounties: reviews asked of you (${b.toReview.length})`)}
          {b.toReview.length === 0 && dim(b.sweptAt ? 'Nobody is waiting on your review.' : 'Sweep to post review requests here.')}
          {b.toReview.slice(0, 12).map(p => {
            const waited = daysOld(p.updated, now)

            return (
              <Box key={`r-${p.url}`} flexDirection="column" borderStyle="round" borderColor={waited >= 2 ? 'error' : 'warning'} paddingX={1}>
                <Box flexDirection="row" gap={1} justifyContent="space-between">
                  <Text weight="bold">
                    {p.repo}#{p.number}
                  </Text>
                  {Link ? <Link href={p.url} label="Review ↗" /> : null}
                </Box>
                <Text>{p.title}</Text>
                <Text color={waited >= 2 ? 'error' : 'inactive'}>
                  Bounty +{XP.review}
                  {waited >= 1 ? `+${XP.reviewWaited}` : ''} XP · waiting {waited}d{p.isDraft ? ' · draft' : ''}
                </Text>
              </Box>
            )
          })}

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
                  {r.label} · {cursed ? `Cursed (${q.status}) · +${XP.unblock} XP to lift` : q.status}
                  {age > 14 ? ` · 🕸 ${age}d untouched` : age > 0 ? ` · ${age}d ago` : ' · today'}
                </Text>
              </Box>
            )
          })}

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
    } else if (tab === 'chronicle') {
      const weekStart = Date.parse(weekOf(now) + 'T00:00:00')
      const week = v.deeds.filter(d => d.at >= weekStart)
      const sum = (k: string) => week.filter(d => d.kind === k).length
      const xpWeek = week.reduce((a, d) => a + d.xp, 0)
      const boss = v.boss
      const bossLine = boss ? (boss.isDefeated ? `Defeated the weekly boss, ${boss.name}` : `Weekly boss ${boss.name} at ${boss.hp}/${boss.maxHp} HP`) : ''
      const text = chronicleText(me.name, v.deeds, weekStart, { quests: jiraQuests.length, reviews: b.toReview.length, prs: b.mine.length }, bossLine)
      body = (
        <Box flexDirection="column" gap={1}>
          {heading('📖 This week in the realm')}
          <Box flexDirection="row" gap={2} flexWrap="wrap">
            <Text>📜 {week.filter(d => d.kind === 'jira' && d.text.startsWith('Cleared')).length} tickets</Text>
            <Text>🔨 {sum('pr')} PRs merged</Text>
            <Text>⚔ {sum('review')} reviews</Text>
            <Text>📋 {sum('contract')} contracts</Text>
            <Text>🕯 {sum('focus')} focus sessions</Text>
            <Text>💎 {sum('relic')} relics</Text>
            <Text color="claude">+{xpWeek} XP</Text>
          </Box>
          {bossLine && <Text color={boss?.isDefeated ? 'success' : 'warning'}>👹 {bossLine}</Text>}
          {heading('Weekly update, ready to paste')}
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            {text.split('\n').map((line, i) => (
              <Text key={`cl-${i}`}>{line}</Text>
            ))}
          </Box>
          <Box flexDirection="row" gap={1}>
            <Button
              key="copy-chronicle"
              label="Copy weekly update"
              variant="primary"
              onPress={async press => {
                const r = await $.ui.copy({ text, surface: press.surface })
                $.ui.toast(r.isCopied ? 'Copied. Paste it into Slack.' : "Couldn't reach the clipboard here; select the text above instead.")
              }}
            />
          </Box>
          {heading('All deeds this week')}
          {week.length === 0 && dim('Nothing chronicled yet this week.')}
          {[...week].reverse().slice(0, 25).map((d, i) => (
            <Box key={`wd-${i}`} flexDirection="row" gap={1}>
              <Text color={d.xp > 0 ? 'success' : 'inactive'} mono tabular>
                {d.xp > 0 ? `+${String(d.xp).padStart(3)}` : '    '}
              </Text>
              <Text>{d.text}</Text>
              {dim(ago(d.at, now))}
            </Box>
          ))}
        </Box>
      )
    } else if (tab === 'treasury') {
      const counts = new Map<string, number>()
      for (const r of v.relics) counts.set(r.id, (counts.get(r.id) ?? 0) + 1)
      const order: Rarity[] = ['legendary', 'epic', 'rare', 'common']
      body = (
        <Box flexDirection="column" gap={1}>
          {heading(`💎 Relics (${uniqueRelics.size}/${RELICS.length})`)}
          {dim('Relics drop from resolved tickets (60%), merged PRs (50%), reviews (30%), the daily chest, and always from a weekly boss.')}
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
                    {Svg && <Svg source={relicSvg(r.rarity, true)} alt={r.rarity} width={24} height={21} />}
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
    } else if (tab === 'market') {
      body = (
        <Box flexDirection="column" gap={1}>
          {heading(`🛍 The Market · 🪙 ${v.gold} gold`)}
          {dim('Spend gold on rewards you choose. Gold comes from tickets (20), PRs (15), reviews (10), contracts (10), focus (5), the daily boon (5) and bosses (100).')}
          {v.shop.length === 0 && dim('No rewards yet. Add one below.')}
          {v.shop.map(r => (
            <Box key={`shop-${r.id}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
              <Text weight="bold">{r.name}</Text>
              <Text color="warning">🪙 {r.cost}</Text>
              {v.gold >= r.cost ? <Button key={`buy-${r.id}`} label="Buy" variant="primary" onPress={() => void buy($, r.id)} /> : dim(`${r.cost - v.gold} more gold`)}
              <Button key={`del-${r.id}`} label="Remove" plain dimColor onPress={() => changeVault($, x => ({ ...x, shop: x.shop.filter(s => s.id !== r.id) }))} />
            </Box>
          ))}
          {Input && <Input key="add-reward" label="Add a reward" placeholder="Name, cost   e.g.  Fancy pastry, 80" submitLabel="Add" onSubmit={value => void addReward($, value)} />}
          {v.purchases.length > 0 && heading('Recent treats')}
          {[...v.purchases].reverse().slice(0, 6).map((p, i) => (
            <Text key={`buyl-${i}`} color="inactive">
              {p.name} · {ago(p.at, now)}
            </Text>
          ))}
        </Box>
      )
    } else if (tab === 'armory') {
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
                <Button key={`eq-${slot}-${c.id}`} label={c.name} variant={wearing === c.id ? 'primary' : 'secondary'} onPress={() => changeVault($, x => ({ ...x, equipped: { ...x.equipped, [slot]: c.id } }))} />
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
          {Input && <Input key="name" label="Hero name" placeholder="Your adventurer's name" value={me.name} submitLabel="Rename" onSubmit={value => changeHero($, x => ({ ...x, name: value.trim().slice(0, 24) || 'Adventurer' }))} />}
          <Text weight="bold">Hall</Text>
          {THEMES.map(theme => {
            const isLocked = theme.unlockAt > info.level

            return (
              <Box key={`theme-${theme.id}`} flexDirection="row" gap={1} alignItems="center">
                {Svg && <Svg source={swatchSvg(theme, isLocked)} alt={theme.name} width={72} height={27} />}
                <Text color={isLocked ? 'inactive' : undefined}>{theme.name}</Text>
                {isLocked ? dim(`🔒 level ${theme.unlockAt}`) : theme.id === t.id ? <Text color="success">✓ In use</Text> : <Button key={`equip-${theme.id}`} label="Use" onPress={() => changeHero($, x => ({ ...x, theme: theme.id }))} />}
              </Box>
            )
          })}
          {slotRow('hat', 'Hat')}
          {slotRow('robe', 'Robe')}
          {slotRow('familiar', 'Familiar')}
          {slotRow('aura', 'Aura')}
          <Text weight="bold">Time of day</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {(
              [
                ['auto', 'Match the app'],
                ['clock', 'Follow the clock'],
                ['day', 'Day'],
                ['night', 'Night'],
              ] as const
            ).map(([id, label]) => (
              <Button key={`scene-${id}`} label={label} variant={v.scene === id ? 'primary' : 'secondary'} onPress={() => changeVault($, x => ({ ...x, scene: id }))} />
            ))}
          </Box>
          <Text weight="bold">Settings</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {toggle('calm', 'Calm mode', v.isCalm, () => changeVault($, x => ({ ...x, isCalm: !x.isCalm })))}
            {toggle('auto-sweep', 'Sweep every 30 min', v.isAutoSweep, async () => {
              await changeVault($, x => ({ ...x, isAutoSweep: !x.isAutoSweep }))
              await startAutoSweep($)
            })}
            {toggle('sound', 'Sound', me.isSoundOn, () => changeHero($, x => ({ ...x, isSoundOn: !x.isSoundOn })))}
          </Box>
          {dim('Calm mode hides numbers, toasts, sounds and effects, and keeps the hall and your quests.')}
        </Box>
      )
    } else {
      // The hall: what needs you, today's contracts, the boss, recent deeds.
      const tally = new Map<string, { n: number; failed: number }>()
      for (const s of sp.slice(-40)) {
        const x = tally.get(s.name) ?? { n: 0, failed: 0 }
        x.n += 1
        if (s.state === 'failed') x.failed += 1
        tally.set(s.name, x)
      }
      const nextLevel = [1, 2, 3, 4, 5, 6].map(d => info.level + d).find(l => unlocksAt(l).length > 0)
      const deeds = [...v.deeds].reverse().slice(0, 8)
      const activeQuest = jiraQuests.find(q => /progress|doing|active/i.test(q.status) || q.category === 'indeterminate')
      const contracts = v.contracts?.list ?? []
      const boss = v.boss
      const bossDef = boss ? BOSSES.find(d => d.id === boss.id) : undefined
      body = (
        <Box flexDirection="column" gap={1}>
          {swept}
          {b.alerts.length > 0 && (
            <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
              <Text color="warning" weight="bold">
                🔔 Since the last sweep
              </Text>
              {b.alerts.map((a, i) => (
                <Text key={`al-${i}`}>• {a}</Text>
              ))}
            </Box>
          )}
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

          {!calm && contracts.length > 0 && (
            <Box flexDirection="column">
              <Text weight="bold">
                📋 Today's contracts ({contracts.filter(c => c.isDone).length}/{contracts.length}){v.contracts?.isChestOpened ? ' · 🎁 chest opened' : ' · finish all three for a chest'}
              </Text>
              {contracts.map((c, i) => (
                <Text key={`ct-${i}`} color={c.isDone ? 'success' : undefined}>
                  {c.isDone ? '✓' : '◇'} {c.text}
                  {c.goal > 1 ? ` (${c.progress}/${c.goal})` : ''} <Text color="inactive">+{30} XP · 🪙10</Text>
                </Text>
              ))}
            </Box>
          )}
          {!calm && contracts.length === 0 && (
            <Button key="contracts" label="Draw today's contracts" onPress={() => void ensureContracts($)} />
          )}

          {!calm && boss && (
            <Box flexDirection="column" borderStyle="round" borderColor={boss.isDefeated ? 'success' : 'error'} paddingX={1}>
              <Text weight="bold" color={boss.isDefeated ? 'success' : 'error'}>
                👹 This week's boss: {boss.name} {boss.isDefeated ? '· defeated!' : `· ${boss.hp}/${boss.maxHp} HP`}
              </Text>
              {Svg && <Svg source={bossSvg(boss.id, boss.hp / boss.maxHp, boss.isDefeated)} alt={boss.name} width={240} height={60} />}
              {!boss.isDefeated && bossDef && (
                <Text color="inactive" italic>
                  "{bossDef.taunt}" Resolve tickets, merge PRs, review, finish contracts and focus to deal damage.
                </Text>
              )}
              {[...boss.hits].reverse().slice(0, 3).map((hit, i) => (
                <Text key={`hit-${i}`} color="inactive">
                  −{hit.dmg} · {hit.text}
                </Text>
              ))}
            </Box>
          )}

          {!calm && nextLevel && (
            <Text color="inactive">
              Level {nextLevel} unlocks: {unlocksAt(nextLevel).join(', ')}
            </Text>
          )}
          {!calm && heading('🏰 Recent deeds')}
          {!calm && deeds.length === 0 && dim('Your deeds will be chronicled here: tickets cleared, PRs merged, relics found.')}
          {!calm &&
            deeds.map((d, i) => (
              <Box key={`deed-${i}`} flexDirection="row" gap={1}>
                <Text color={d.xp > 0 ? 'success' : 'inactive'} mono tabular>
                  {d.xp > 0 ? `+${String(d.xp).padStart(3)}` : '    '}
                </Text>
                <Text>{d.text}</Text>
                {dim(ago(d.at, now))}
              </Box>
            ))}
          {!calm && heading('✦ Spellbook')}
          {!calm && tally.size === 0 && dim('No spells cast yet this session.')}
          {!calm && (
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
          )}
          {!calm && dim(`Tool calls and turns earn up to ${XP.activityCap} XP a day; real outcomes earn the rest.`)}
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

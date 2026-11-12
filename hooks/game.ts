import type { Boss, Contract, ContractKind, Contracts, Deed, Hero, JiraQuest, Rarity, Vault } from '../types'

// ---------- XP rules ----------

export const XP = {
  spell: 1, // a tool call that succeeds (activity: capped per day)
  turn: 3, // an answered turn (activity: capped per day)
  activityCap: 40, // most XP tool calls and turns can earn in a day: outcomes level you, not busywork
  questAccepted: 2, // Claude posts a task
  questCleared: 20, // Claude completes a task (a side quest)
  prMerged: 60, // one of your PRs merged
  review: 35, // a review you gave on someone else's PR
  reviewWaited: 25, // bonus when the author had waited over a day
  unblock: 40, // a blocked ticket you got moving again
  focus: 15, // per 25 minutes of finished focus
  dailyBoon: 20, // first activity of the day, times the streak (5-rung ladder)
} as const

/** XP for a Jira ticket you resolved, by type. */
export function jiraXp(type: string): number {
  const t = type.toLowerCase()
  if (t === 'epic') return 200
  if (t === 'story') return 90
  if (t === 'bug') return 80
  if (t === 'spike') return 60
  if (t === 'sub-task' || t === 'subtask') return 35

  return 70
}

/** XP needed to go from level n to n+1. */
export const xpForLevel = (n: number) => Math.round(100 * Math.pow(n, 1.5))

export type LevelInfo = { level: number; into: number; needed: number; fraction: number }

export function levelOf(xp: number): LevelInfo {
  let level = 1
  let left = Math.max(0, Math.floor(xp))
  while (left >= xpForLevel(level) && level < 99) {
    left -= xpForLevel(level)
    level += 1
  }
  const needed = xpForLevel(level)

  return { level, into: left, needed, fraction: left / needed }
}

// ---------- Titles ----------

const TITLES: ReadonlyArray<[number, string]> = [
  [1, 'Apprentice Scribe'],
  [3, 'Hedge Wizard'],
  [5, 'Code-Sorcerer'],
  [8, 'Battlemage of Builds'],
  [12, 'Archmage of Merges'],
  [16, 'Grand Loremaster'],
  [20, 'Legend of the Realm'],
]

export function titleFor(level: number): string {
  let title = 'Apprentice Scribe'
  for (const [at, name] of TITLES) if (level >= at) title = name

  return title
}

// ---------- Themes ----------

export type Particle = 'none' | 'fireflies' | 'embers' | 'snow' | 'wisps' | 'stars' | 'bubbles' | 'gears'

export type Theme = {
  id: string
  name: string
  unlockAt: number
  wall: string
  brick: string
  floor: string
  accent: string
  trim: string
  parchment: string
  ink: string
  flame: string
  glow: string
  particle: Particle
  particleColor: string
}

export const THEMES: readonly Theme[] = [
  { id: 'stone', name: 'Stone Guild Hall', unlockAt: 1, wall: '#3a3540', brick: '#2a2630', floor: '#2b211b', accent: '#8b1e2d', trim: '#d4a845', parchment: '#e8d5a8', ink: '#3b2a1a', flame: '#ffb347', glow: '#ff8c1a', particle: 'embers', particleColor: '#ffb347' },
  { id: 'grove', name: 'Elven Grove', unlockAt: 3, wall: '#24382a', brick: '#1a2a1f', floor: '#2e2416', accent: '#2f6b3a', trim: '#c9e27a', parchment: '#e9e3c0', ink: '#23301f', flame: '#b6ff7a', glow: '#7cff9a', particle: 'fireflies', particleColor: '#e8ff8a' },
  { id: 'forge', name: 'Dwarven Forge', unlockAt: 5, wall: '#3b2a22', brick: '#261a14', floor: '#1e1612', accent: '#a33a12', trim: '#f0a030', parchment: '#e8cfa0', ink: '#3a2010', flame: '#ff7a1a', glow: '#ff4d00', particle: 'embers', particleColor: '#ff9a3a' },
  { id: 'frost', name: 'Frost Citadel', unlockAt: 8, wall: '#2b3a4f', brick: '#1d2938', floor: '#3c4f66', accent: '#2d5f8f', trim: '#cfe8ff', parchment: '#eef6ff', ink: '#1c2a3a', flame: '#8fd8ff', glow: '#4fb8ff', particle: 'snow', particleColor: '#ffffff' },
  { id: 'crypt', name: "Necromancer's Crypt", unlockAt: 12, wall: '#241f2e', brick: '#17131f', floor: '#15121b', accent: '#3d2a5c', trim: '#8cff9e', parchment: '#d9d2c0', ink: '#241a2e', flame: '#7dff8f', glow: '#39ff6a', particle: 'wisps', particleColor: '#8cff9e' },
  { id: 'celestial', name: 'Celestial Observatory', unlockAt: 16, wall: '#141a3a', brick: '#0d1129', floor: '#1c1f40', accent: '#4a3a8f', trim: '#ffd86b', parchment: '#f3ecd6', ink: '#1d1a3a', flame: '#fff1a8', glow: '#ffd86b', particle: 'stars', particleColor: '#fff6c8' },
  { id: 'archive', name: 'Sunken Archive', unlockAt: 18, wall: '#1f3a40', brick: '#132a2f', floor: '#183034', accent: '#1f6f78', trim: '#9ff0e0', parchment: '#e4f2ee', ink: '#12292c', flame: '#9ff0e0', glow: '#3fd6c0', particle: 'bubbles', particleColor: '#bff7ee' },
  { id: 'clockwork', name: 'Clockwork Spire', unlockAt: 19, wall: '#3d3528', brick: '#2a2419', floor: '#231d14', accent: '#7a5a1e', trim: '#e8c46a', parchment: '#efe3c4', ink: '#2e2412', flame: '#ffd27a', glow: '#ffb000', particle: 'gears', particleColor: '#e8c46a' },
]

export const themeById = (id: string, level: number): Theme => {
  const found = THEMES.find(t => t.id === id)

  return found && found.unlockAt <= level ? found : (THEMES[0] as Theme)
}

// ---------- Cosmetics: something new at every level ----------

export type Slot = 'hat' | 'robe' | 'familiar' | 'aura'

export type Cosmetic = { slot: Slot; id: string; name: string; unlockAt: number }

export const COSMETICS: readonly Cosmetic[] = [
  { slot: 'hat', id: 'pointed', name: 'Pointed hat', unlockAt: 1 },
  { slot: 'hat', id: 'feathered', name: 'Feathered hat', unlockAt: 2 },
  { slot: 'hat', id: 'crown', name: 'Circlet crown', unlockAt: 7 },
  { slot: 'hat', id: 'starry', name: 'Starry hat', unlockAt: 11 },
  { slot: 'hat', id: 'hood', name: 'Shadow hood', unlockAt: 13 },
  { slot: 'robe', id: 'theme', name: 'Guild colors', unlockAt: 1 },
  { slot: 'robe', id: 'royal', name: 'Royal purple robe', unlockAt: 9 },
  { slot: 'robe', id: 'gilded', name: 'Gilded robe', unlockAt: 15 },
  { slot: 'familiar', id: 'none', name: 'No familiar', unlockAt: 1 },
  { slot: 'familiar', id: 'cat', name: 'Tabby cat', unlockAt: 2 },
  { slot: 'familiar', id: 'owl', name: 'Owl', unlockAt: 4 },
  { slot: 'familiar', id: 'fox', name: 'Ember fox', unlockAt: 6 },
  { slot: 'familiar', id: 'raven', name: 'Raven', unlockAt: 9 },
  { slot: 'familiar', id: 'whelp', name: 'Dragon whelp', unlockAt: 10 },
  { slot: 'familiar', id: 'phoenix', name: 'Phoenix chick', unlockAt: 14 },
  { slot: 'familiar', id: 'golem', name: 'Pocket golem', unlockAt: 17 },
  { slot: 'aura', id: 'none', name: 'No aura', unlockAt: 1 },
  { slot: 'aura', id: 'sparks', name: 'Arcane sparks', unlockAt: 6 },
  { slot: 'aura', id: 'halo', name: 'Halo of green builds', unlockAt: 12 },
  { slot: 'aura', id: 'starfall', name: 'Starfall', unlockAt: 20 },
]

/** The best item of a slot unlocked at this level: what a hero wears when they have not picked. */
export function bestFor(slot: Slot, level: number): string {
  let best = slot === 'robe' ? 'theme' : slot === 'hat' ? 'pointed' : 'none'
  for (const c of COSMETICS) if (c.slot === slot && c.unlockAt <= level) best = c.id

  return best
}

/** What the hero wears: the chosen item if still unlocked, else the best unlocked one. */
export function wornFor(slot: Slot, chosen: string, level: number): string {
  if (chosen === 'auto' || chosen === '') return bestFor(slot, level)
  const c = COSMETICS.find(x => x.slot === slot && x.id === chosen)

  return c && c.unlockAt <= level ? c.id : bestFor(slot, level)
}

/** Everything that unlocks exactly when reaching `level`. */
export function unlocksAt(level: number): string[] {
  if (level <= 1) return []
  const out: string[] = []
  for (const t of THEMES) if (t.unlockAt === level) out.push(`${t.name} theme`)
  for (const c of COSMETICS) if (c.unlockAt === level) out.push(c.name)
  for (const [at, name] of TITLES) if (at === level) out.push(`the title "${name}"`)
  if (out.length === 0) out.push(`+${level * 10} bonus XP chest`)

  return out
}

// ---------- Relics (loot) ----------

export type RelicDef = { id: string; name: string; rarity: Rarity; lore: string }

export const RELICS: readonly RelicDef[] = [
  { id: 'duck', name: 'Rubber Duck of Insight', rarity: 'common', lore: 'Listens. Judges silently.' },
  { id: 'quill', name: 'Self-Inking Quill', rarity: 'common', lore: 'Writes commit messages nobody reads.' },
  { id: 'mug', name: 'Bottomless Coffee Mug', rarity: 'common', lore: 'Still warm from the standup.' },
  { id: 'scroll-todo', name: 'Scroll of TODOs', rarity: 'common', lore: 'Longer every time you unroll it.' },
  { id: 'lint', name: 'Pouch of Lint', rarity: 'common', lore: 'Warnings, mostly.' },
  { id: 'candle', name: 'Late-Night Candle', rarity: 'common', lore: 'Burns at both ends.' },
  { id: 'cache-key', name: 'Rusty Cache Key', rarity: 'common', lore: 'Opens something. Invalidates something else.' },
  { id: 'tabs', name: 'Amulet of Tabs and Spaces', rarity: 'common', lore: 'Ends arguments by starting new ones.' },
  { id: 'ward', name: 'Merge Conflict Ward', rarity: 'rare', lore: 'Keeps <<<<<<< away from your door.' },
  { id: 'phial', name: 'Phial of Green Builds', rarity: 'rare', lore: 'Shake well before CI.' },
  { id: 'compass', name: 'Compass of the Stack Trace', rarity: 'rare', lore: 'Always points to line 1 of the wrong file.' },
  { id: 'rebase', name: 'Tome of Interactive Rebase', rarity: 'rare', lore: 'Squash, fixup, pray.' },
  { id: 'lantern', name: 'Lantern of Logs', rarity: 'rare', lore: 'Shines on what happened, not why.' },
  { id: 'boots', name: 'Boots of Hotfix Haste', rarity: 'rare', lore: '+20% speed on Fridays. Use with care.' },
  { id: 'mirror', name: 'Mirror of Code Review', rarity: 'epic', lore: 'Shows you your own diff, kindly.' },
  { id: 'hourglass', name: 'Hourglass of Estimates', rarity: 'epic', lore: 'Sand runs at twice the planned rate.' },
  { id: 'crown-uptime', name: 'Crown of Five Nines', rarity: 'epic', lore: 'Heavy is the head that holds the pager.' },
  { id: 'gauntlet', name: 'Gauntlet of the Flaky Test', rarity: 'epic', lore: 'Passes on the second try.' },
  { id: 'dragon-egg', name: 'Dragon Egg of Legacy Code', rarity: 'epic', lore: 'Do not wake what sleeps in /legacy.' },
  { id: 'orb', name: 'Orb of Zero Regressions', rarity: 'legendary', lore: 'Said to exist. Never observed in production.' },
  { id: 'grimoire', name: 'Grimoire of Perfect Docs', rarity: 'legendary', lore: 'Every function, explained. Even the weird one.' },
  { id: 'sword', name: 'Blade of the Clean Main', rarity: 'legendary', lore: 'Forged in a green pipeline.' },
]

export const relicById = (id: string) => RELICS.find(r => r.id === id)

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  return (h >>> 0) / 4294967296
}

/** Roll a relic for a deed; deterministic per deed id so a re-sweep never rerolls. */
export function rollRelic(seed: string, chance = 0.6): RelicDef | null {
  if (hash(seed + ':drop') > chance) return null
  const r = hash(seed + ':rarity')
  const rarity: Rarity = r < 0.05 ? 'legendary' : r < 0.18 ? 'epic' : r < 0.45 ? 'rare' : 'common'
  const pool = RELICS.filter(x => x.rarity === rarity)

  return pool[Math.floor(hash(seed + ':pick') * pool.length)] ?? null
}

/** A boss's spoils: always epic or legendary. */
export function rollBossRelic(seed: string): RelicDef {
  const pool = RELICS.filter(r => r.rarity === (hash(seed + ':boss') < 0.25 ? 'legendary' : 'epic'))

  return pool[Math.floor(hash(seed + ':bosspick') * pool.length)] ?? RELICS[0]!
}

// ---------- Achievements ----------

export type AchievementDef = { id: string; name: string; text: string; xp: number; check: (h: Hero, v: Vault) => boolean }

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-quest', name: 'First Quest', text: 'Resolve a Jira ticket', xp: 50, check: (_h, v) => v.tallies.jira >= 1 },
  { id: 'quests-10', name: 'Seasoned Adventurer', text: 'Resolve 10 tickets', xp: 200, check: (_h, v) => v.tallies.jira >= 10 },
  { id: 'quests-50', name: 'Hero of the Realm', text: 'Resolve 50 tickets', xp: 600, check: (_h, v) => v.tallies.jira >= 50 },
  { id: 'bugs-5', name: 'Bug Slayer', text: 'Resolve 5 bugs', xp: 200, check: (_h, v) => v.tallies.bugs >= 5 },
  { id: 'pr-1', name: 'First Forging', text: 'Get a PR merged', xp: 50, check: (_h, v) => v.tallies.prs >= 1 },
  { id: 'pr-10', name: 'Master Smith', text: 'Get 10 PRs merged', xp: 250, check: (_h, v) => v.tallies.prs >= 10 },
  { id: 'reviews-5', name: 'Watchful Eye', text: 'Review 5 PRs', xp: 120, check: (_h, v) => v.tallies.reviews >= 5 },
  { id: 'reviews-25', name: 'High Inquisitor', text: 'Review 25 PRs', xp: 400, check: (_h, v) => v.tallies.reviews >= 25 },
  { id: 'spells-1k', name: 'Spellslinger', text: 'Cast 1,000 spells', xp: 100, check: h => h.spellsCast >= 1000 },
  { id: 'spells-5k', name: "Archmage's Tongue", text: 'Cast 5,000 spells', xp: 300, check: h => h.spellsCast >= 5000 },
  { id: 'spells-10k', name: 'Weaver of Ten Thousand', text: 'Cast 10,000 spells', xp: 600, check: h => h.spellsCast >= 10000 },
  { id: 'side-25', name: 'Errand Runner', text: "Clear 25 of Claude's side quests", xp: 150, check: h => h.questsCleared >= 25 },
  { id: 'streak-3', name: 'Steadfast', text: '3-day streak', xp: 100, check: (_h, v) => v.streak.days >= 3 },
  { id: 'streak-7', name: 'Unbroken', text: '7-day streak', xp: 300, check: (_h, v) => v.streak.days >= 7 },
  { id: 'lifetime-30', name: 'Regular at the Hall', text: '30 days in the hall', xp: 300, check: (_h, v) => v.streak.lifetime >= 30 },
  { id: 'boss-1', name: 'Giant Slayer', text: 'Defeat a weekly boss', xp: 200, check: (_h, v) => v.tallies.bosses >= 1 },
  { id: 'boss-5', name: 'Bane of Bosses', text: 'Defeat 5 weekly bosses', xp: 500, check: (_h, v) => v.tallies.bosses >= 5 },
  { id: 'contracts-10', name: 'Contractor', text: 'Complete 10 daily contracts', xp: 150, check: (_h, v) => v.tallies.contracts >= 10 },
  { id: 'focus-10', name: 'Still Mind', text: 'Finish 10 focus sessions', xp: 150, check: (_h, v) => v.tallies.focus >= 10 },
  { id: 'relics-10', name: 'Collector', text: 'Find 10 different relics', xp: 200, check: (_h, v) => new Set(v.relics.map(r => r.id)).size >= 10 },
  { id: 'legendary', name: 'Touched by Legend', text: 'Find a legendary relic', xp: 250, check: (_h, v) => v.relics.some(r => relicById(r.id)?.rarity === 'legendary') },
]

// ---------- Hero & vault ----------

export const NEW_HERO: Hero = {
  name: 'Adventurer',
  xp: 0,
  questsCleared: 0,
  spellsCast: 0,
  turns: 0,
  theme: 'stone',
  isNarrating: false,
  isSoundOn: true,
}

/** Reads whatever an earlier version stored, filling gaps with defaults. */
export function normalizeHero(raw: unknown): Hero {
  if (raw === null || typeof raw !== 'object') return NEW_HERO
  const r = raw as Record<string, unknown>
  const num = (k: keyof Hero) =>
    typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : (NEW_HERO[k] as number)
  const bool = (k: keyof Hero) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (NEW_HERO[k] as boolean))
  const str = (k: keyof Hero) =>
    typeof r[k] === 'string' && (r[k] as string).length > 0 ? (r[k] as string).slice(0, 32) : (NEW_HERO[k] as string)

  return {
    name: str('name'),
    xp: num('xp'),
    questsCleared: num('questsCleared'),
    spellsCast: num('spellsCast'),
    turns: num('turns'),
    theme: str('theme'),
    isNarrating: bool('isNarrating'),
    isSoundOn: bool('isSoundOn'),
  }
}

export const DEFAULT_SHOP: readonly { id: string; name: string; cost: number }[] = [
  { id: 'walk', name: '15-minute walk', cost: 40 },
  { id: 'coffee', name: 'Coffee run', cost: 60 },
  { id: 'lunch', name: 'Lunch somewhere nice', cost: 250 },
]

export const NEW_VAULT: Vault = {
  relics: [],
  achievements: [],
  credited: { jira: [], prs: [], reviews: [] },
  baselined: { jira: false, github: false },
  tallies: { jira: 0, bugs: 0, prs: 0, reviews: 0, contracts: 0, bosses: 0, focus: 0 },
  streak: { days: 0, last: '', shields: 0, best: 0, lifetime: 0 },
  equipped: { hat: 'auto', robe: 'auto', familiar: 'auto', aura: 'auto' },
  scene: 'auto',
  isAutoSweep: true,
  isCalm: false,
  deeds: [],
  gold: 0,
  shop: [...DEFAULT_SHOP],
  purchases: [],
  boss: null,
  contracts: null,
  activity: { day: '', xp: 0 },
  nagged: {},
  chronicleNudged: '',
}

const strs = (x: unknown, cap: number) =>
  Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(-cap) : []
const n0 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const s0 = (x: unknown, d: string) => (typeof x === 'string' ? x : d)

const DEED_KINDS = ['jira', 'pr', 'review', 'relic', 'boss', 'level', 'contract', 'focus', 'streak', 'achievement', 'other']
const CONTRACT_KINDS = ['review-stale', 'review-any', 'cobweb', 'unblock', 'resolve', 'merge', 'green', 'focus', 'side']

function normalizeBoss(b: any): Boss | null {
  if (!b || typeof b !== 'object' || typeof b.week !== 'string') return null

  return {
    week: b.week,
    id: s0(b.id, 'hydra'),
    name: s0(b.name, 'The Flaky Hydra'),
    maxHp: Math.max(1, n0(b.maxHp)),
    hp: Math.max(0, n0(b.hp)),
    isDefeated: b.isDefeated === true,
    hits: Array.isArray(b.hits) ? b.hits.filter((h: any) => h && typeof h.text === 'string').map((h: any) => ({ at: n0(h.at), text: String(h.text).slice(0, 120), dmg: n0(h.dmg) })).slice(-30) : [],
  }
}

function normalizeContracts(c: any): Contracts | null {
  if (!c || typeof c !== 'object' || typeof c.day !== 'string' || !Array.isArray(c.list)) return null

  return {
    day: c.day,
    isChestOpened: c.isChestOpened === true,
    list: c.list
      .filter((x: any) => x && CONTRACT_KINDS.includes(x.kind))
      .map((x: any) => ({ kind: x.kind, text: s0(x.text, ''), targets: strs(x.targets, 20), isDone: x.isDone === true, progress: n0(x.progress), goal: Math.max(1, n0(x.goal) || 1) }))
      .slice(0, 3),
  }
}

export function normalizeVault(raw: unknown): Vault {
  if (raw === null || typeof raw !== 'object') return { ...NEW_VAULT, shop: [...DEFAULT_SHOP] }
  const r = raw as Record<string, any>
  const scene = r.scene === 'day' || r.scene === 'night' || r.scene === 'clock' ? r.scene : 'auto'
  const nagged: Record<string, string> = {}
  if (r.nagged && typeof r.nagged === 'object') for (const [k, v] of Object.entries(r.nagged).slice(-200)) if (typeof v === 'string') nagged[k] = v

  return {
    relics: Array.isArray(r.relics)
      ? r.relics.filter((x: any) => x && typeof x.id === 'string' && relicById(x.id)).map((x: any) => ({ id: x.id, at: n0(x.at) })).slice(-500)
      : [],
    achievements: strs(r.achievements, 200),
    credited: { jira: strs(r.credited?.jira, 2000), prs: strs(r.credited?.prs, 2000), reviews: strs(r.credited?.reviews, 2000) },
    baselined: { jira: r.baselined?.jira === true, github: r.baselined?.github === true },
    tallies: {
      jira: n0(r.tallies?.jira),
      bugs: n0(r.tallies?.bugs),
      prs: n0(r.tallies?.prs),
      reviews: n0(r.tallies?.reviews),
      contracts: n0(r.tallies?.contracts),
      bosses: n0(r.tallies?.bosses),
      focus: n0(r.tallies?.focus),
    },
    streak: {
      days: n0(r.streak?.days),
      last: s0(r.streak?.last, ''),
      shields: Math.min(2, n0(r.streak?.shields)),
      best: Math.max(n0(r.streak?.best), n0(r.streak?.days)),
      lifetime: Math.max(n0(r.streak?.lifetime), n0(r.streak?.days)),
    },
    equipped: {
      hat: s0(r.equipped?.hat, 'auto'),
      robe: s0(r.equipped?.robe, 'auto'),
      familiar: s0(r.equipped?.familiar, 'auto'),
      aura: s0(r.equipped?.aura, 'auto'),
    },
    scene,
    isAutoSweep: r.isAutoSweep !== false,
    isCalm: r.isCalm === true,
    deeds: Array.isArray(r.deeds)
      ? r.deeds
          .filter((d: any) => d && typeof d.text === 'string')
          .map((d: any) => ({ at: n0(d.at), text: String(d.text).slice(0, 160), xp: n0(d.xp), kind: DEED_KINDS.includes(d.kind) ? d.kind : 'other' }))
          .slice(-300)
      : [],
    gold: n0(r.gold),
    shop: Array.isArray(r.shop)
      ? r.shop.filter((x: any) => x && typeof x.name === 'string').map((x: any) => ({ id: s0(x.id, String(x.name)), name: String(x.name).slice(0, 40), cost: Math.max(1, Math.round(n0(x.cost))) })).slice(0, 20)
      : [...DEFAULT_SHOP],
    purchases: Array.isArray(r.purchases) ? r.purchases.filter((x: any) => x && typeof x.name === 'string').map((x: any) => ({ id: s0(x.id, ''), name: String(x.name), at: n0(x.at) })).slice(-30) : [],
    boss: normalizeBoss(r.boss),
    contracts: normalizeContracts(r.contracts),
    activity: { day: s0(r.activity?.day, ''), xp: n0(r.activity?.xp) },
    nagged,
    chronicleNudged: s0(r.chronicleNudged, ''),
  }
}

/** Calendar day, local to the machine, as YYYY-MM-DD. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const noon = (day: string) => Date.parse(day + 'T12:00:00')

export function isNextDay(prev: string, today: string): boolean {
  if (!prev) return false

  return Math.round((noon(today) - noon(prev)) / 86400000) === 1
}

/** Monday of the week `ms` falls in, as YYYY-MM-DD. */
export function weekOf(ms: number): string {
  const d = new Date(ms)
  const back = (d.getDay() + 6) % 7

  return dayOf(ms - back * 86400000)
}

// ---------- Streaks: forgiving by design ----------
// Weekends never break a streak. Every 5 streak days earns a shield (hold 2) that covers a missed
// workday by itself. A miss with no shield halves the streak instead of zeroing it. The boon climbs
// a 5-rung ladder, and a lifetime day count never resets.

export type StreakStep = { days: number; shields: number; best: number; lifetime: number; usedShields: number; isStepDown: boolean; boon: number }

export function stepStreak(s: Vault['streak'], today: string): StreakStep {
  let missed = 0
  if (s.last) {
    for (let t = noon(s.last) + 86400000; t < noon(today) - 3600000; t += 86400000) {
      const wd = new Date(t).getDay()
      if (wd !== 0 && wd !== 6) missed += 1
    }
  }
  let days = s.days
  let shields = s.shields
  let usedShields = 0
  let isStepDown = false
  if (!s.last) days = 1
  else if (missed === 0) days += 1
  else if (shields >= missed) {
    shields -= missed
    usedShields = missed
    days += 1
  } else {
    days = Math.max(1, Math.floor(days / 2))
    isStepDown = true
  }
  if (days > 0 && days % 5 === 0 && !isStepDown) shields = Math.min(2, shields + 1)

  return { days, shields, usedShields, isStepDown, best: Math.max(s.best, days), lifetime: s.lifetime + 1, boon: XP.dailyBoon * Math.min(days, 5) }
}

// ---------- Weekly boss ----------

export type BossDef = { id: string; name: string; taunt: string }

export const BOSSES: readonly BossDef[] = [
  { id: 'hydra', name: 'The Flaky Hydra', taunt: 'Cut one test, two more fail.' },
  { id: 'lich', name: 'Lich of Legacy Code', taunt: 'I was here before your linter.' },
  { id: 'wyrm', name: 'Merge-Conflict Wyrm', taunt: '<<<<<<< HEAD' },
  { id: 'golem', name: 'Scope-Creep Golem', taunt: 'Just one more small thing…' },
  { id: 'wraith', name: 'The Null Pointer Wraith', taunt: 'undefined is not a function.' },
  { id: 'kraken', name: 'Kraken of Tech Debt', taunt: 'We will refactor it later.' },
]

export function newBoss(week: string, openQuests: number): Boss {
  const def = BOSSES[Math.floor(hashOf(week) * BOSSES.length)] ?? BOSSES[0]!
  const maxHp = Math.min(900, 240 + 30 * openQuests)

  return { week, id: def.id, name: def.name, maxHp, hp: maxHp, isDefeated: false, hits: [] }
}

export const DAMAGE = { pr: 60, review: 40, contract: 30, focus: 25, unblock: 50 } as const

// ---------- Daily contracts ----------

export type BoardView = { quests: JiraQuest[]; toReview: { url: string; updated: string }[]; mine: { url: string; checks: string }[] }

export function pickContracts(day: string, b: BoardView, now: number): Contract[] {
  const age = (iso: string) => {
    const t = Date.parse(iso)

    return Number.isFinite(t) ? (now - t) / 86400000 : 0
  }
  const stale = b.toReview.filter(p => age(p.updated) >= 2).map(p => p.url)
  const cobwebs = b.quests.filter(q => age(q.updated) > 14).map(q => q.key)
  const cursed = b.quests.filter(q => isCursed(q.status)).map(q => q.key)
  const failing = b.mine.filter(p => p.checks === 'FAILURE' || p.checks === 'ERROR').map(p => p.url)
  const pool: Contract[] = []
  const add = (kind: ContractKind, text: string, targets: string[] = [], goal = 1) => pool.push({ kind, text, targets: targets.slice(0, 20), isDone: false, progress: 0, goal })
  if (stale.length) add('review-stale', 'Review a PR that has waited 2+ days', stale)
  if (cursed.length) add('unblock', 'Lift the curse from a blocked ticket', cursed)
  if (failing.length) add('green', 'Turn a failing PR green', failing)
  if (cobwebs.length) add('cobweb', 'Dust off a cobwebbed ticket', cobwebs)
  if (b.toReview.length) add('review-any', 'Give a review')
  if (b.quests.length) add('resolve', 'Resolve a ticket')
  add('focus', 'Finish a focus session (/focus)')
  add('side', "Clear 3 of Claude's side quests", [], 3)
  add('merge', 'Get a PR merged')
  // The first three that apply, lightly shuffled per day so the list rotates.
  const head = pool.slice(0, 4)
  const rotated = head.sort((a, c) => hashOf(day + a.kind) - hashOf(day + c.kind))

  return [...rotated, ...pool.slice(4)].slice(0, 3)
}

export const CONTRACT_REWARD = { xp: 30, gold: 10 } as const
export const CHEST_REWARD = { gold: 25 } as const

// ---------- Gold ----------

export const GOLD = { jira: 20, pr: 15, review: 10, boss: 100, boon: 5, focus: 5 } as const

function hashOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  return (h >>> 0) / 4294967296
}

// ---------- Weekly chronicle ----------

export function chronicleText(name: string, deeds: readonly Deed[], weekStart: number, open: { quests: number; reviews: number; prs: number }, bossLine: string): string {
  const week = deeds.filter(d => d.at >= weekStart)
  const keys = (re: RegExp) => week.map(d => d.text.match(re)?.[1]).filter((x): x is string => !!x)
  const resolved = keys(/^Cleared (\S+)/)
  const merged = week.filter(d => d.kind === 'pr').map(d => d.text.replace(/^PR merged: /, ''))
  const reviews = week.filter(d => d.kind === 'review').length
  const lines = [`*Weekly update* (${name})`]
  lines.push(`• Resolved ${resolved.length} ticket${resolved.length === 1 ? '' : 's'}${resolved.length ? `: ${resolved.join(', ')}` : ''}`)
  lines.push(`• ${merged.length} PR${merged.length === 1 ? '' : 's'} merged${merged.length ? `: ${merged.slice(0, 6).join('; ')}` : ''}`)
  lines.push(`• ${reviews} review${reviews === 1 ? '' : 's'} given`)
  lines.push(`• Still open: ${open.quests} ticket${open.quests === 1 ? '' : 's'}, ${open.prs} PR${open.prs === 1 ? '' : 's'} of mine, ${open.reviews} review request${open.reviews === 1 ? '' : 's'}`)
  if (bossLine) lines.push(`• ${bossLine}`)

  return lines.join('\n')
}

// ---------- Time of day ----------

export type Phase = 'dawn' | 'day' | 'dusk' | 'night'

export function phaseAt(ms: number): Phase {
  const h = new Date(ms).getHours()
  if (h >= 6 && h < 8) return 'dawn'
  if (h >= 8 && h < 17) return 'day'
  if (h >= 17 && h < 20) return 'dusk'

  return 'night'
}

export type Season = 'winter' | 'harvest' | 'none'

export function seasonAt(ms: number): Season {
  const m = new Date(ms).getMonth()
  if (m === 11 || m === 0) return 'winter'
  if (m === 9) return 'harvest'

  return 'none'
}

// ---------- Jira helpers ----------

export function rankOf(q: JiraQuest): { label: string; rarity: Rarity } {
  const t = q.type.toLowerCase()
  if (t === 'epic') return { label: 'Legendary saga', rarity: 'legendary' }
  if (t === 'story') return { label: 'Saga', rarity: 'epic' }
  if (t === 'bug') return { label: 'Monster hunt', rarity: 'rare' }
  if (t === 'spike') return { label: 'Expedition', rarity: 'rare' }

  return { label: 'Errand', rarity: 'common' }
}

export const isBountyStatus = (status: string) => /\b(in pr|in review|code review|review)\b/i.test(status)
export const isCursed = (status: string) => /block/i.test(status)

// ---------- Spells (tool calls) ----------

type SpellName = { name: string; school: string }

const BUILTIN: Record<string, SpellName> = {
  Bash: { name: "Golem's Command", school: 'Conjuration' },
  Read: { name: 'Scry Scroll', school: 'Divination' },
  Write: { name: 'Inscribe Tome', school: 'Enchantment' },
  Edit: { name: 'Transmute Text', school: 'Transmutation' },
  NotebookEdit: { name: 'Amend Grimoire', school: 'Transmutation' },
  Glob: { name: 'Seek the Hidden', school: 'Divination' },
  Grep: { name: 'Seek the Hidden', school: 'Divination' },
  WebSearch: { name: 'Consult the Oracle', school: 'Divination' },
  WebFetch: { name: 'Summon Distant Page', school: 'Conjuration' },
  TaskCreate: { name: 'Post a Quest', school: 'Guildcraft' },
  TaskUpdate: { name: 'Mark the Ledger', school: 'Guildcraft' },
  TaskList: { name: 'Read the Board', school: 'Guildcraft' },
  TaskGet: { name: 'Read the Board', school: 'Guildcraft' },
  TodoWrite: { name: 'Mark the Ledger', school: 'Guildcraft' },
  Agent: { name: 'Summon Familiar', school: 'Conjuration' },
  Workflow: { name: 'Muster the Party', school: 'Conjuration' },
  Skill: { name: 'Open Grimoire', school: 'Lore' },
  ToolSearch: { name: 'Rummage Spellbook', school: 'Lore' },
  Artifact: { name: 'Forge Artifact', school: 'Artifice' },
  SendUserMessage: { name: 'Herald Speaks', school: 'Bardic' },
  SendUserFile: { name: 'Deliver Parcel', school: 'Bardic' },
  AskUserQuestion: { name: 'Riddle of the Sphinx', school: 'Bardic' },
}

const MCP: ReadonlyArray<[RegExp, SpellName]> = [
  [/slack/i, { name: 'Send Raven', school: 'Messenger' }],
  [/atlassian|jira|confluence/i, { name: 'Consult Guild Ledger', school: 'Guildcraft' }],
  [/github/i, { name: 'Strike the Forge', school: 'Artifice' }],
  [/gmail/i, { name: 'Courier Pigeon', school: 'Messenger' }],
  [/calendar/i, { name: 'Read the Stars', school: 'Divination' }],
  [/drive|docs/i, { name: 'Open the Archive', school: 'Lore' }],
  [/figma/i, { name: 'Weave Illusion', school: 'Illusion' }],
  [/chrome|browser/i, { name: 'Gaze in Crystal Ball', school: 'Divination' }],
  [/remote-devices/i, { name: 'Open Portal Home', school: 'Conjuration' }],
]

export function spellFor(tool: string): SpellName {
  const known = BUILTIN[tool]
  if (known) return known
  if (tool.startsWith('mcp__')) {
    for (const [re, spell] of MCP) if (re.test(tool)) return spell

    return { name: 'Distant Rite', school: 'Conjuration' }
  }

  return { name: 'Arcane Rite', school: 'Mysteries' }
}

export const bar = (fraction: number, cells = 12) => {
  const full = Math.max(0, Math.min(cells, Math.round(fraction * cells)))

  return '█'.repeat(full) + '░'.repeat(cells - full)
}

export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`

  return `${Math.round(s / 86400)}d ago`
}

export const NARRATOR_PROMPT = [
  "The user has the Guild Hall mod on, which frames their work as a fantasy adventurers' guild.",
  'You may open a reply with at most one short, light fantasy-flavored line (an innkeeper or guild-master voice),',
  'for example "The quest board stirs, adventurer." Keep it to one line and only where it fits naturally.',
  'Everything technical stays plain, precise and unchanged: code, commands, file paths, names, numbers and',
  'any text the user will send to others are never written in the fantasy voice.',
].join(' ')

import type { Hero } from '../types'

// ---------- XP rules ----------

export const XP = {
  spell: 1, // any tool call that succeeds
  turn: 3, // each answered turn
  questAccepted: 2, // a task Claude creates
  questCleared: 20, // a task marked completed
} as const

/** XP needed to go from level n to n+1. */
export const xpForLevel = (n: number) => Math.round(100 * Math.pow(n, 1.5))

export type LevelInfo = {
  level: number
  into: number // XP earned inside this level
  needed: number // XP this level takes
  fraction: number
}

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

// ---------- Themes & unlocks ----------

export type Particle = 'none' | 'fireflies' | 'embers' | 'snow' | 'wisps' | 'stars'

export type Theme = {
  id: string
  name: string
  unlockAt: number
  wall: string
  brick: string
  floor: string
  panel: string
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
  {
    id: 'stone', name: 'Stone Guild Hall', unlockAt: 1,
    wall: '#3a3540', brick: '#2a2630', floor: '#2b211b', panel: '#221e27',
    accent: '#8b1e2d', trim: '#d4a845', parchment: '#e8d5a8', ink: '#3b2a1a',
    flame: '#ffb347', glow: '#ff8c1a', particle: 'embers', particleColor: '#ffb347',
  },
  {
    id: 'grove', name: 'Elven Grove', unlockAt: 3,
    wall: '#24382a', brick: '#1a2a1f', floor: '#2e2416', panel: '#16241a',
    accent: '#2f6b3a', trim: '#c9e27a', parchment: '#e9e3c0', ink: '#23301f',
    flame: '#b6ff7a', glow: '#7cff9a', particle: 'fireflies', particleColor: '#e8ff8a',
  },
  {
    id: 'forge', name: 'Dwarven Forge', unlockAt: 5,
    wall: '#3b2a22', brick: '#261a14', floor: '#1e1612', panel: '#1f1510',
    accent: '#a33a12', trim: '#f0a030', parchment: '#e8cfa0', ink: '#3a2010',
    flame: '#ff7a1a', glow: '#ff4d00', particle: 'embers', particleColor: '#ff9a3a',
  },
  {
    id: 'frost', name: 'Frost Citadel', unlockAt: 8,
    wall: '#2b3a4f', brick: '#1d2938', floor: '#3c4f66', panel: '#1a2533',
    accent: '#2d5f8f', trim: '#cfe8ff', parchment: '#eef6ff', ink: '#1c2a3a',
    flame: '#8fd8ff', glow: '#4fb8ff', particle: 'snow', particleColor: '#ffffff',
  },
  {
    id: 'crypt', name: "Necromancer's Crypt", unlockAt: 12,
    wall: '#241f2e', brick: '#17131f', floor: '#15121b', panel: '#15111c',
    accent: '#3d2a5c', trim: '#8cff9e', parchment: '#d9d2c0', ink: '#241a2e',
    flame: '#7dff8f', glow: '#39ff6a', particle: 'wisps', particleColor: '#8cff9e',
  },
  {
    id: 'celestial', name: 'Celestial Observatory', unlockAt: 16,
    wall: '#141a3a', brick: '#0d1129', floor: '#1c1f40', panel: '#10142e',
    accent: '#4a3a8f', trim: '#ffd86b', parchment: '#f3ecd6', ink: '#1d1a3a',
    flame: '#fff1a8', glow: '#ffd86b', particle: 'stars', particleColor: '#fff6c8',
  },
]

export const themeById = (id: string, level: number): Theme => {
  const found = THEMES.find(t => t.id === id)

  return found && found.unlockAt <= level ? found : (THEMES[0] as Theme)
}

export type Familiar = { id: 'none' | 'owl' | 'whelp'; name: string; unlockAt: number }

export const FAMILIARS: readonly Familiar[] = [
  { id: 'owl', name: 'Owl familiar', unlockAt: 4 },
  { id: 'whelp', name: 'Dragon whelp familiar', unlockAt: 10 },
]

export const familiarFor = (level: number): Familiar['id'] =>
  level >= 10 ? 'whelp' : level >= 4 ? 'owl' : 'none'

/** Everything that unlocks exactly when reaching `level`. */
export function unlocksAt(level: number): string[] {
  const out: string[] = []
  for (const t of THEMES) if (t.unlockAt === level && level > 1) out.push(`${t.name} theme`)
  for (const f of FAMILIARS) if (f.unlockAt === level) out.push(f.name)
  for (const [at, name] of TITLES) if (at === level && level > 1) out.push(`title "${name}"`)

  return out
}

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

// ---------- Hero ----------

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

export const bar = (fraction: number, cells = 10) => {
  const full = Math.max(0, Math.min(cells, Math.round(fraction * cells)))

  return '▰'.repeat(full) + '▱'.repeat(cells - full)
}

export const NARRATOR_PROMPT = [
  'The user has the Guild Hall mod on, which frames their work as a fantasy adventurers\' guild.',
  'You may open a reply with at most one short, light fantasy-flavored line (an innkeeper or guild-master voice),',
  'for example "The quest board stirs, adventurer." Keep it to one line and only where it fits naturally.',
  'Everything technical stays plain, precise and unchanged: code, commands, file paths, names, numbers and',
  'any text the user will send to others are never written in the fantasy voice.',
].join(' ')

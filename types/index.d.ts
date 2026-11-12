// Kept exactly as in 0.1.x: the saved hero ($.store "hero") reads straight back.
export type Hero = {
  name: string
  xp: number
  questsCleared: number
  spellsCast: number
  turns: number
  theme: string
  isNarrating: boolean
  isSoundOn: boolean
}

export type QuestStatus = 'pending' | 'in_progress' | 'completed'

/** A task from Claude's own task list: a side quest. */
export type Quest = { id: string; subject: string; status: QuestStatus }

export type SpellState = 'casting' | 'done' | 'failed'

export type Spell = {
  id: string
  tool: string
  name: string
  school: string
  state: SpellState
}

export type View = 'hall' | 'quests' | 'chronicle' | 'treasury' | 'market' | 'armory'

/** A Jira ticket assigned to you. */
export type JiraQuest = {
  key: string
  summary: string
  status: string
  category: string
  type: string
  priority: string
  url: string
  updated: string
}

/** A GitHub pull request. */
export type PullRequest = {
  url: string
  title: string
  repo: string
  number: number
  isDraft: boolean
  review: string
  checks: string
  updated: string
}

export type Board = {
  quests: JiraQuest[]
  mine: PullRequest[]
  toReview: PullRequest[]
  sweptAt: number
  jiraNote: string
  githubNote: string
  isSweeping: boolean
  /** What changed in the last sweep that needs you. */
  alerts: string[]
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export type Relic = { id: string; at: number }

export type DeedKind = 'jira' | 'pr' | 'review' | 'relic' | 'boss' | 'level' | 'contract' | 'focus' | 'streak' | 'achievement' | 'other'

export type Deed = { at: number; text: string; xp: number; kind?: DeedKind }

export type Boss = {
  week: string
  id: string
  name: string
  maxHp: number
  hp: number
  isDefeated: boolean
  hits: { at: number; text: string; dmg: number }[]
}

export type ContractKind = 'review-stale' | 'review-any' | 'cobweb' | 'unblock' | 'resolve' | 'merge' | 'green' | 'focus' | 'side'

export type Contract = { kind: ContractKind; text: string; targets: string[]; isDone: boolean; progress: number; goal: number }

export type Contracts = { day: string; list: Contract[]; isChestOpened: boolean }

export type Reward = { id: string; name: string; cost: number }

export type Vault = {
  relics: Relic[]
  achievements: string[]
  credited: { jira: string[]; prs: string[]; reviews: string[] }
  baselined: { jira: boolean; github: boolean }
  tallies: { jira: number; bugs: number; prs: number; reviews: number; contracts: number; bosses: number; focus: number }
  streak: { days: number; last: string; shields: number; best: number; lifetime: number }
  equipped: { hat: string; robe: string; familiar: string; aura: string }
  scene: 'auto' | 'clock' | 'day' | 'night'
  isAutoSweep: boolean
  isCalm: boolean
  deeds: Deed[]
  gold: number
  shop: Reward[]
  purchases: { id: string; name: string; at: number }[]
  boss: Boss | null
  contracts: Contracts | null
  /** Activity XP (tool calls, turns) earned on `day`; capped so busywork can't level you. */
  activity: { day: string; xp: number }
  /** Review requests already nagged about, by URL, with the day. */
  nagged: Record<string, string>
  /** The last Friday a chronicle reminder went out. */
  chronicleNudged: string
}

export type Celebration = { level: number; unlocked: string[]; at: number; kind?: 'level' | 'boss' }

export type Mood = { kind: 'cheer' | 'alarm' | 'proud' | 'curious' | 'sleep'; line: string; at: number }

export type Focus = { startAt: number; endsAt: number; minutes: number }

/** Effects drawn for a moment in the hall. */
export type Fx = { payout: number; fireworks: boolean; at: number }

declare module 'claude-code' {
  interface PluginState {
    'guild-hall': {
      hero: Shaped<Hero>
      quests: Shaped<Quest[]>
      spells: Shaped<Spell[]>
      view: View
      isBandHidden: boolean
      board: Shaped<Board>
      vault: Shaped<Vault>
      celebration: Celebration | null
      mood: Mood | null
      focus: Focus | null
      fx: Fx | null
      tick: number
      lastActive: number
    }
  }
}

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

export type View = 'hall' | 'quests' | 'treasury' | 'armory'

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
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export type Relic = { id: string; at: number }

export type Deed = { at: number; text: string; xp: number }

export type Vault = {
  relics: Relic[]
  achievements: string[]
  credited: { jira: string[]; prs: string[]; reviews: string[] }
  baselined: { jira: boolean; github: boolean }
  tallies: { jira: number; bugs: number; prs: number; reviews: number }
  streak: { days: number; last: string }
  equipped: { hat: string; robe: string; familiar: string; aura: string }
  scene: 'auto' | 'day' | 'night'
  isAutoSweep: boolean
  deeds: Deed[]
}

export type Celebration = { level: number; unlocked: string[]; at: number }

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
    }
  }
}

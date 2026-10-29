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

export type Quest = { id: string; subject: string; status: QuestStatus }

export type SpellState = 'casting' | 'done' | 'failed'

export type Spell = {
  id: string
  tool: string
  name: string
  school: string
  state: SpellState
}

export type View = 'hall' | 'armory'

declare module 'claude-code' {
  interface PluginState {
    'guild-hall': {
      hero: Shaped<Hero>
      quests: Shaped<Quest[]>
      spells: Shaped<Spell[]>
      view: View
      isBandHidden: boolean
    }
  }
}

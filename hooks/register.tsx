import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Hero, Quest, QuestStatus, Spell, View } from '../types'
import { hallSvg, swatchSvg } from './art'
import {
  FAMILIARS,
  NARRATOR_PROMPT,
  NEW_HERO,
  THEMES,
  XP,
  bar,
  levelOf,
  normalizeHero,
  spellFor,
  themeById,
  titleFor,
  unlocksAt,
} from './game'

const PANE = 'guild-hall'
const TITLE = 'Guild Hall'

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const hero = atom({ plugin: 'guild-hall', key: 'hero' } as const, NEW_HERO, { shape: 'hero-1' })
const quests = atom({ plugin: 'guild-hall', key: 'quests' } as const, [] as Quest[], { shape: 'quests-1' })
const spells = atom({ plugin: 'guild-hall', key: 'spells' } as const, [] as Spell[], { shape: 'spells-1' })
const view = atom({ plugin: 'guild-hall', key: 'view' } as const, 'hall' as View)
const isBandHidden = atom({ plugin: 'guild-hall', key: 'isBandHidden' } as const, false)

type Engine = EngineInterface

const playSound = ($: Engine, me: Hero, asset: string) => {
  if (me.isSoundOn) void $.audio.play({ asset }).catch(() => undefined)
}

/** Writes the hero to session state and to the cross-session store. */
async function changeHero($: Engine, fn: (me: Hero) => Hero): Promise<{ before: Hero; after: Hero }> {
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

async function grant($: Engine, xp: number, patch: (me: Hero) => Partial<Hero> = () => ({})) {
  const { before, after } = await changeHero($, me => ({ ...me, ...patch(me), xp: me.xp + xp }))
  const from = levelOf(before.xp).level
  const to = levelOf(after.xp).level
  if (to > from) {
    const unlocked = []
    for (let lvl = from + 1; lvl <= to; lvl++) unlocked.push(...unlocksAt(lvl))
    const extra = unlocked.length ? ` Unlocked: ${unlocked.join(', ')}.` : ''
    $.ui.toast(`✨ LEVEL UP! Level ${to}: ${titleFor(to)}.${extra}`)
    playSound($, after, 'sounds/levelup.wav')
  }
}

// ---------- Quests (Claude's task list) ----------

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
  let name = subject ?? `Quest #${id}`
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
    const me = await read($, hero)
    $.ui.toast(`📜 Quest cleared: ${name} (+${XP.questCleared} XP)`)
    playSound($, me, 'sounds/quest.wav')
  }
}

async function dropQuest($: Engine, id: string) {
  await update($, quests, list => (list ?? []).filter(q => q.id !== id))
}

// ---------- Start-up ----------

// Module variables start over on a reload; the store and state do not.
let isReady = false

async function ensureReady($: Engine) {
  if (isReady) return
  isReady = true
  const saved = await $.store.get('hero')
  if (saved !== undefined) await update($, hero, () => normalizeHero(saved))
  try {
    await $.command.register({ name: 'guild', description: 'Open the Guild Hall pane' })
  } catch {
    // already registered this session
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isReady = false
    await ensureReady($)
    void $.ui.open({ id: PANE, title: TITLE })

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

  // Every tool call is a spell; a successful one earns a little XP.
  on('tool.call', async ($, e, next) => {
    await ensureReady($)
    const tool = String(e.tool)
    const id = e.tool_use_id
    const spell = spellFor(tool)
    await update($, spells, list => [...(list ?? []), { id, tool, ...spell, state: 'casting' as const }].slice(-30))
    const ran = await next(e)
    const hasFailed = ran.deny !== undefined || ran.isError === true
    await update($, spells, list =>
      (list ?? []).map(s => (s.id === id ? { ...s, state: hasFailed ? ('failed' as const) : ('done' as const) } : s)),
    )
    if (!hasFailed) await grant($, XP.spell, me => ({ spellsCast: me.spellsCast + 1 }))

    return ran
  }).catch(($, e, next) => next(e))

  // Claude's own task list becomes the quest board.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = (ran.result as { task?: { id?: string; subject?: string } } | undefined)?.task
    if (ran.isError !== true && task?.id) await postQuest($, String(task.id), task.subject ?? e.subject)

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && e.taskId) {
      if (e.status === 'deleted') await dropQuest($, e.taskId)
      else if (e.status) await moveQuest($, e.taskId, e.status, e.subject)
      else if (e.subject) await moveQuest($, e.taskId, 'pending', e.subject)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // The same events from the hooks side (teammates, other routes); deduplicated by id.
  on('classic.TaskCreated', async ($, e, next) => {
    await postQuest($, e.task_id, e.task_subject)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.TaskCompleted', async ($, e, next) => {
    await moveQuest($, e.task_id, 'completed', e.task_subject)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'answer') await grant($, XP.turn, me => ({ turns: me.turns + 1 }))

    return next(e)
  }).catch(($, e, next) => next(e))

  // Optional innkeeper voice, off by default.
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const me = await read($, hero)
    if (!me?.isNarrating) return out

    return { sections: [...out.sections, { id: 'guild-hall:narrator', text: NARRATOR_PROMPT, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  // ---------- The band above the prompt ----------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const me = await read($, hero)
    const info = levelOf(me.xp)
    const t = themeById(me.theme, info.level)
    const active = (await read($, quests)).find(q => q.status === 'in_progress')

    return (
      <Box flexDirection="row" gap={1} backgroundColor={t.panel} paddingX={1} alignItems="center">
        <Text color={t.trim} weight="bold">
          ⚔ Lv {info.level} {titleFor(info.level)}
        </Text>
        <Text color={t.glow}>{bar(info.fraction)}</Text>
        <Text color={t.parchment}>
          {info.into}/{info.needed} XP
        </Text>
        {active && (
          <Text color={t.parchment} wrap="truncate-end">
            · Quest: {active.subject}
          </Text>
        )}
        <Button key="open" label="Hall" plain onPress={() => void $.ui.open({ id: PANE, title: TITLE, focus: true })} />
        <Button key="hide" label="Hide" plain dimColor onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  // ---------- The pane ----------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const Input = 'Input' in els ? els.Input : undefined

    const me = await read($, hero)
    const qs = await read($, quests)
    const sp = await read($, spells)
    const current = await read($, view)
    const info = levelOf(me.xp)
    const t = themeById(me.theme, info.level)
    const width = Math.min(640, Math.max(240, (e.props.bodyColumns ?? 60) * 8))
    const active = qs.find(q => q.status === 'in_progress') ?? null

    const header = Svg ? (
      <Svg
        source={hallSvg(me, info, t, active?.subject ?? null)}
        alt={`${me.name}, level ${info.level} ${titleFor(info.level)}, ${info.into} of ${info.needed} XP`}
        width={width}
        isInteractive
      />
    ) : (
      <Text color={t.trim} weight="bold">
        ⚔ {me.name} · Lv {info.level} {titleFor(info.level)} · {bar(info.fraction)} {info.into}/{info.needed} XP
      </Text>
    )

    const controls = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button
          key="armory"
          label={current === 'armory' ? '← Back to the Hall' : '🛡 Armory'}
          onPress={() => update($, view, v => (v === 'armory' ? 'hall' : 'armory'))}
        />
        <Button
          key="narrator"
          label={`🍺 Narrator: ${me.isNarrating ? 'on' : 'off'}`}
          onPress={() => changeHero($, x => ({ ...x, isNarrating: !x.isNarrating }))}
        />
        <Button
          key="sound"
          label={`🎵 Sound: ${me.isSoundOn ? 'on' : 'off'}`}
          onPress={() => changeHero($, x => ({ ...x, isSoundOn: !x.isSoundOn }))}
        />
      </Box>
    )

    const section = (label: string) => (
      <Text color={t.trim} weight="bold" size="heading">
        {label}
      </Text>
    )

    if (current === 'armory') {
      return (
        <Box flexDirection="column" gap={1} backgroundColor={t.panel} padding={1}>
          {header}
          {controls}
          {section('The Armory')}
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
          <Text color={t.parchment}>Themes</Text>
          {THEMES.map(theme => {
            const isLocked = theme.unlockAt > info.level
            const isEquipped = theme.id === t.id

            return (
              <Box key={`theme-${theme.id}`} flexDirection="row" gap={1} alignItems="center">
                {Svg && <Svg source={swatchSvg(theme, isLocked)} alt={theme.name} width={96} />}
                <Text color={isLocked ? '#8a8a8a' : t.parchment}>{theme.name}</Text>
                {isLocked ? (
                  <Text color="#8a8a8a">🔒 Lv {theme.unlockAt}</Text>
                ) : isEquipped ? (
                  <Text color={t.glow}>✓ Equipped</Text>
                ) : (
                  <Button
                    key={`equip-${theme.id}`}
                    label="Equip"
                    onPress={() => changeHero($, x => ({ ...x, theme: theme.id }))}
                  />
                )}
              </Box>
            )
          })}
          <Text color={t.parchment}>Familiars</Text>
          {FAMILIARS.map(f => (
            <Text color={f.unlockAt > info.level ? '#8a8a8a' : t.parchment}>
              {f.unlockAt > info.level ? `🔒 Lv ${f.unlockAt}` : '✓'} {f.name}
            </Text>
          ))}
        </Box>
      )
    }

    const order: Record<QuestStatus, number> = { in_progress: 0, pending: 1, completed: 2 }
    const board = [...qs].sort((a, b) => order[a.status] - order[b.status]).slice(0, 10)
    const recent = [...sp].reverse().slice(0, 8)
    const nextUnlock = [info.level + 1, info.level + 2, info.level + 3, info.level + 4, info.level + 5, info.level + 6]
      .map(lvl => ({ lvl, items: unlocksAt(lvl) }))
      .find(x => x.items.length > 0)

    return (
      <Box flexDirection="column" gap={1} backgroundColor={t.panel} padding={1}>
        {header}
        {controls}

        {section('📜 Quest Board')}
        {board.length === 0 && (
          <Text color={t.parchment} dimColor>
            The board is bare. Ask Claude to take on some work and its tasks will be posted here as quests.
          </Text>
        )}
        {board.map(q => {
          const isDone = q.status === 'completed'
          const tag = q.status === 'in_progress' ? '⚔ ACTIVE' : isDone ? '✓ CLEARED' : '◇ POSTED'

          return (
            <Box
              key={`quest-${q.id}`}
              flexDirection="row"
              justifyContent="space-between"
              gap={1}
              backgroundColor={t.parchment}
              borderStyle="round"
              borderColor={q.status === 'in_progress' ? t.glow : t.trim}
              paddingX={1}
            >
              <Text color={t.ink} strikethrough={isDone} wrap="truncate-end">
                {q.subject}
              </Text>
              <Text color={t.ink} weight="bold">
                {tag}
              </Text>
            </Box>
          )
        })}

        {section('✦ Spellbook')}
        {recent.length === 0 && (
          <Text color={t.parchment} dimColor>
            No spells cast yet this session.
          </Text>
        )}
        {recent.map(s => (
          <Text color={s.state === 'failed' ? '#ff7b7b' : s.state === 'casting' ? t.glow : t.parchment} wrap="truncate-end">
            {s.state === 'casting' ? '✧' : s.state === 'failed' ? '✗' : '✦'} {s.name} · {s.school}
            {s.state === 'casting' ? ' …' : ''}
          </Text>
        ))}

        {section('🏰 Chronicle')}
        <Text color={t.parchment}>
          Quests cleared {me.questsCleared} · Spells cast {me.spellsCast} · Turns {me.turns} · Total XP {me.xp}
        </Text>
        {nextUnlock && (
          <Text color={t.parchment} dimColor>
            Next unlock at Lv {nextUnlock.lvl}: {nextUnlock.items.join(', ')}
          </Text>
        )}
      </Box>
    )
  })
}

import type { Hero } from '../types'
import type { LevelInfo, Particle, Theme } from './game'
import { familiarFor, titleFor } from './game'

// All art is hand-placed pixels drawn as SVG rects: no external assets.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function sprite(rows: readonly string[], colors: Record<string, string>, x: number, y: number, px: number, extra = '') {
  let out = ''
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const fill = colors[row.charAt(c)]
      if (fill) out += `<rect x="${x + c * px}" y="${y + r * px}" width="${px}" height="${px}" fill="${fill}"${extra}/>`
    }
  })

  return out
}

const WIZARD = [
  '......HH......',
  '.....HHHH.....',
  '....HHHHHH..O.',
  '...HHHHHHHH.W.',
  '..BBBBBBBBBBW.',
  '....SSSSSS..W.',
  '....SESSES..W.',
  '....DDDDDD..W.',
  '...RDDDDDDR.W.',
  '..RRRDDDDRRRW.',
  '..RRRRDDRRRSW.',
  '..RRRRTTRRRRW.',
  '..RRRRTTRRRRW.',
  '..RRRRTTRRRRW.',
  '..RRRRRRRRRRW.',
  '...KK....KK.W.',
  '...KK....KK.W.',
]

const OWL = ['.F..F.', 'FFFFFF', 'FYFFYF', 'FFBBFF', '.FFFF.', '..FF..']

const WHELP = ['G.....G.', 'GG..GGG.', '.GGGGYG.', 'GGGGGGGG', '.G.GG.G.', '.....GG.']

function torch(x: number, t: Theme, delay: string) {
  return `
  <circle cx="${x}" cy="30" r="26" fill="url(#glow-${t.id})" opacity="0.55">
    <animate attributeName="r" values="24;29;25;28;24" dur="1.6s" begin="${delay}" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.45;0.65;0.5;0.6;0.45" dur="1.3s" begin="${delay}" repeatCount="indefinite"/>
  </circle>
  <rect x="${x - 3}" y="34" width="6" height="14" fill="#5a3b22"/>
  <rect x="${x - 5}" y="32" width="10" height="3" fill="${t.trim}"/>
  <g transform="translate(${x} 32)">
    <g>
      <animateTransform attributeName="transform" type="scale" values="1 1;0.85 1.15;1.1 0.9;0.9 1.1;1 1" dur="0.9s" begin="${delay}" repeatCount="indefinite"/>
      <rect x="-4" y="-8" width="8" height="8" fill="${t.glow}"/>
      <rect x="-3" y="-12" width="6" height="5" fill="${t.flame}"/>
      <rect x="-2" y="-15" width="4" height="4" fill="${t.flame}"/>
      <rect x="-1" y="-6" width="2" height="5" fill="#fff8e0"/>
    </g>
  </g>`
}

function particles(kind: Particle, color: string) {
  if (kind === 'none') return ''
  let out = ''
  for (let i = 0; i < 12; i++) {
    const x = (i * 53 + 17) % 320
    const dur = 3 + ((i * 7) % 5)
    const begin = `${(i * 0.37).toFixed(2)}s`
    if (kind === 'snow') {
      out += `<rect x="${x}" y="-4" width="2" height="2" fill="${color}" opacity="0.8"><animate attributeName="y" values="-4;100" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/></rect>`
    } else if (kind === 'embers') {
      out += `<rect x="${x}" y="96" width="2" height="2" fill="${color}"><animate attributeName="y" values="96;10" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/></rect>`
    } else if (kind === 'stars') {
      const y = (i * 29 + 5) % 60
      out += `<rect x="${x}" y="${y}" width="2" height="2" fill="${color}"><animate attributeName="opacity" values="0.1;1;0.1" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/></rect>`
    } else {
      // fireflies and wisps drift
      const y = 30 + ((i * 23) % 55)
      out += `<circle cx="${x}" cy="${y}" r="${kind === 'wisps' ? 2.5 : 1.5}" fill="${color}"><animate attributeName="cx" values="${x};${x + 10};${x - 6};${x}" dur="${dur + 2}s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="cy" values="${y};${y - 8};${y + 4};${y}" dur="${dur + 1}s" begin="${begin}" repeatCount="indefinite"/><animate attributeName="opacity" values="0.2;1;0.3;0.2" dur="${dur}s" begin="${begin}" repeatCount="indefinite"/></circle>`
    }
  }

  return out
}

/** The hall scene: torches, banner, hero, familiar, and the hero's plate with the XP bar. */
export function hallSvg(hero: Hero, info: LevelInfo, t: Theme, activeQuest: string | null): string {
  const title = titleFor(info.level)
  const familiar = familiarFor(info.level)
  const barW = 156
  const fill = Math.max(2, Math.round(barW * info.fraction))
  const quest = activeQuest ? (activeQuest.length > 34 ? activeQuest.slice(0, 33) + '…' : activeQuest) : 'Awaiting a quest…'

  const wizard = sprite(
    WIZARD,
    {
      H: t.accent, B: t.trim, S: '#f1c27d', E: '#1a1a1a', D: '#e8e8e8',
      R: t.accent, T: t.trim, W: '#8b5a2b', K: '#2a1d14',
    },
    34, 45, 3,
  )
  // the orb on the staff pulses
  const orb = `<rect x="${34 + 12 * 3}" y="${45 + 2 * 3}" width="3" height="3" fill="${t.glow}"><animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite"/></rect>
  <circle cx="${34 + 12 * 3 + 1.5}" cy="${45 + 2 * 3 + 1.5}" r="5" fill="${t.glow}" opacity="0.25"><animate attributeName="r" values="4;7;4" dur="1.4s" repeatCount="indefinite"/></circle>`

  let pet = ''
  if (familiar === 'owl') {
    pet = `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="2.2s" repeatCount="indefinite"/>${sprite(OWL, { F: '#8a6a4a', Y: '#ffd23f', B: '#e08a2a' }, 86, 58, 3)}</g>`
  } else if (familiar === 'whelp') {
    pet = `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -4;0 0" dur="1.8s" repeatCount="indefinite"/>${sprite(WHELP, { G: '#4caf50', Y: '#ffd23f' }, 84, 56, 3)}</g>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120" width="640" height="240" shape-rendering="crispEdges" font-family="'Press Start 2P','Courier New',monospace">
  <defs>
    <pattern id="bricks-${t.id}" width="20" height="10" patternUnits="userSpaceOnUse">
      <rect width="20" height="10" fill="${t.wall}"/>
      <rect width="20" height="1" fill="${t.brick}"/>
      <rect width="1" height="5" fill="${t.brick}"/>
      <rect x="10" y="5" width="1" height="5" fill="${t.brick}"/>
    </pattern>
    <radialGradient id="glow-${t.id}"><stop offset="0" stop-color="${t.glow}" stop-opacity="0.9"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="320" height="96" fill="url(#bricks-${t.id})"/>
  <rect y="96" width="320" height="24" fill="${t.floor}"/>
  <rect y="96" width="320" height="2" fill="${t.brick}"/>
  <rect x="60" y="104" width="1" height="16" fill="${t.brick}"/><rect x="150" y="100" width="1" height="20" fill="${t.brick}"/><rect x="250" y="106" width="1" height="14" fill="${t.brick}"/>
  ${particles(t.particle, t.particleColor)}
  ${torch(16, t, '0s')}
  ${torch(304, t, '0.4s')}
  <g>
    <rect x="140" y="0" width="40" height="34" fill="${t.accent}"/>
    <polygon points="140,34 160,44 180,34" fill="${t.accent}"/>
    <rect x="140" y="0" width="40" height="2" fill="${t.trim}"/>
    <rect x="140" y="0" width="2" height="34" fill="${t.trim}"/><rect x="178" y="0" width="2" height="34" fill="${t.trim}"/>
    <rect x="159" y="7" width="2" height="20" fill="${t.trim}"/>
    <rect x="154" y="11" width="12" height="2" fill="${t.trim}"/>
    <rect x="158" y="27" width="4" height="3" fill="${t.trim}"/>
  </g>
  ${wizard}
  ${orb}
  ${pet}
  <g>
    <rect x="114" y="50" width="176" height="64" fill="${t.parchment}"/>
    <rect x="114" y="50" width="176" height="2" fill="${t.trim}"/><rect x="114" y="112" width="176" height="2" fill="${t.trim}"/>
    <rect x="112" y="52" width="2" height="60" fill="${t.trim}"/><rect x="290" y="52" width="2" height="60" fill="${t.trim}"/>
    <circle cx="282" cy="104" r="5" fill="${t.accent}"/><circle cx="282" cy="104" r="2" fill="${t.trim}"/>
    <text x="122" y="64" font-size="8" fill="${t.ink}" font-weight="bold">${esc(hero.name)}</text>
    <text x="122" y="75" font-size="5.5" fill="${t.ink}">LV ${info.level} · ${esc(title.toUpperCase())}</text>
    <rect x="122" y="80" width="${barW + 4}" height="9" fill="${t.ink}"/>
    <rect x="124" y="82" width="${barW}" height="5" fill="${t.panel}"/>
    <rect x="124" y="82" width="${fill}" height="5" fill="${t.glow}"/>
    <rect x="124" y="82" width="10" height="5" fill="#ffffff" opacity="0.35"><animate attributeName="x" values="124;${124 + Math.max(0, fill - 10)};124" dur="3s" repeatCount="indefinite"/></rect>
    <text x="122" y="96" font-size="5" fill="${t.ink}">${info.into} / ${info.needed} XP</text>
    <text x="122" y="106" font-size="5" fill="${t.ink}" opacity="0.85">⚔ ${esc(quest)}</text>
  </g>
</svg>`
}

/** A small locked/unlocked swatch for the Armory. */
export function swatchSvg(t: Theme, isLocked: boolean): string {
  const lock = isLocked
    ? `<rect width="64" height="24" fill="#000" opacity="0.55"/><rect x="28" y="10" width="8" height="7" fill="#cfcfcf"/><rect x="29" y="6" width="6" height="5" fill="none" stroke="#cfcfcf" stroke-width="1.5"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 24" width="96" height="36" shape-rendering="crispEdges">
  <rect width="64" height="24" fill="${t.wall}"/><rect y="18" width="64" height="6" fill="${t.floor}"/>
  <rect x="26" y="0" width="12" height="12" fill="${t.accent}"/><rect x="26" y="0" width="12" height="1" fill="${t.trim}"/>
  <rect x="6" y="6" width="3" height="4" fill="${t.flame}"/><rect x="55" y="6" width="3" height="4" fill="${t.flame}"/>
  ${lock}
</svg>`
}

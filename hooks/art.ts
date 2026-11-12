import type { Particle, Theme } from './game'

// All art is hand-placed pixels drawn as SVG: no external assets.
// The scene follows the app's light/dark setting (day hall / torch-lit night)
// unless the hero forces one in the Armory.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function sprite(rows: readonly string[], colors: Record<string, string>, x: number, y: number, px: number) {
  let out = ''
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const fill = colors[row.charAt(c)]
      if (fill) out += `<rect x="${x + c * px}" y="${y + r * px}" width="${px}" height="${px}" fill="${fill}"/>`
    }
  })

  return out
}

function mix(hex: string, toward: string, amount: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const a = p(hex)
  const b = p(toward)
  const c = a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * amount))

  return '#' + c.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
}

// ---------- the hero ----------

const HATS: Record<string, readonly string[]> = {
  pointed: ['......HH......', '.....HHHH.....', '....HHHHHH....', '...HHHHHHHH...', '..BBBBBBBBBB..'],
  feathered: ['.........FF...', '......HHFF....', '.....HHHHH....', '...HHHHHHHH...', '..BBBBBBBBBB..'],
  crown: ['..............', '..............', '...C..CC..C...', '...CCCCCCCC...', '...CGCCCCGC...'],
  starry: ['......HH......', '.....HYHH.....', '....HHHHYH....', '...HYHHHHHH...', '..BBBBBBBBBB..'],
  hood: ['..............', '.....HHHH.....', '....HHHHHH....', '...HHHHHHHH...', '..HHHHHHHHHH..'],
}

const BODY = [
  '....SSSSSS....',
  '....SESSES....',
  '....DDDDDD....',
  '...RDDDDDDR...',
  '..RRRDDDDRRR..',
  '..RRRRDDRRRS..',
  '..RRRRTTRRRR..',
  '..RRRRTTRRRR..',
  '..RRRRTTRRRR..',
  '..RRRRRRRRRR..',
  '...KK....KK...',
  '...KK....KK...',
]

const ROBES: Record<string, { robe: string; trim: string } | null> = {
  theme: null,
  royal: { robe: '#5b2a86', trim: '#e0c060' },
  gilded: { robe: '#b8901c', trim: '#fff3b0' },
}

const FAMILIARS: Record<string, { rows: readonly string[]; colors: Record<string, string>; bob: number }> = {
  cat: { rows: ['K...K.', 'KK.KK.', 'KGKGK.', 'KKKKK.', '.KKKKK', '.K.K.K'], colors: { K: '#c98a4b', G: '#4caf50' }, bob: 1 },
  owl: { rows: ['.F..F.', 'FFFFFF', 'FYFFYF', 'FFBBFF', '.FFFF.', '..FF..'], colors: { F: '#8a6a4a', Y: '#ffd23f', B: '#e08a2a' }, bob: 3 },
  fox: { rows: ['F....F', 'FF..FF', 'FWFFWF', '.FFFF.', '..FF..', '.FFFFF'], colors: { F: '#e8742a', W: '#ffffff' }, bob: 1 },
  raven: { rows: ['..BB..', '.BBBY.', 'BBBBBO', '.BBBB.', '..BB..', '.B..B.'], colors: { B: '#2a2b35', Y: '#ffd23f', O: '#e0a030' }, bob: 3 },
  whelp: { rows: ['G.....G.', 'GG..GGG.', '.GGGGYG.', 'GGGGGGGG', '.G.GG.G.', '.....GG.'], colors: { G: '#4caf50', Y: '#ffd23f' }, bob: 4 },
  phoenix: { rows: ['..R...', '.ROR..', 'RRRRO.', '.RYR..', '.R.R..', 'R...R.'], colors: { R: '#ff5a2a', O: '#ffd23f', Y: '#fff1a8' }, bob: 4 },
  golem: { rows: ['.SSSS.', 'SYSSYS', 'SSSSSS', '.SSSS.', 'SS..SS', 'SS..SS'], colors: { S: '#8a8f99', Y: '#7cff9a' }, bob: 1 },
}

function hero(t: Theme, hat: string, robe: string): string {
  const r = ROBES[robe] ?? null
  const robeColor = r?.robe ?? t.accent
  const trim = r?.trim ?? t.trim
  const x = 34
  const y = 45
  const colors = { H: robeColor, B: trim, F: '#d23b3b', C: '#e6c34a', G: '#3fb3ff', Y: '#fff1a8', S: '#f1c27d', E: '#1a1a1a', D: '#e8e8e8', R: robeColor, T: trim, K: '#2a1d14' }
  let out = sprite(HATS[hat] ?? HATS.pointed!, colors, x, y, 3)
  out += sprite(BODY, colors, x, y + 15, 3)
  if (hat === 'hood') out += sprite(['..H........H..', '..H........H..'], colors, x, y + 15, 3)
  // staff and its pulsing orb
  out += `<rect x="${x + 36}" y="${y + 9}" width="3" height="42" fill="#8b5a2b"/>`
  out += `<rect x="${x + 36}" y="${y + 6}" width="3" height="3" fill="${t.glow}"><animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite"/></rect>`
  out += `<circle cx="${x + 37.5}" cy="${y + 7.5}" r="5" fill="${t.glow}" opacity="0.25"><animate attributeName="r" values="4;7;4" dur="1.4s" repeatCount="indefinite"/></circle>`

  return out
}

function familiar(id: string): string {
  const f = FAMILIARS[id]
  if (!f) return ''
  const w = (f.rows[0]?.length ?? 6) * 3

  return `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -${f.bob};0 0" dur="2s" repeatCount="indefinite"/>${sprite(f.rows, f.colors, 96 - w / 2 + 6, 78, 3)}</g>`
}

function aura(id: string, t: Theme): string {
  if (id === 'halo') {
    return `<ellipse cx="55" cy="43" rx="14" ry="3" fill="none" stroke="#7cff9a" stroke-width="1.5"><animate attributeName="opacity" values="0.4;1;0.4" dur="2.4s" repeatCount="indefinite"/></ellipse>`
  }
  const pts = id === 'sparks' ? [[28, 60], [82, 52], [30, 84], [84, 80], [56, 40]] : id === 'starfall' ? [[30, 30], [50, 24], [70, 32], [40, 20], [80, 26], [60, 18]] : []
  const color = id === 'starfall' ? '#fff6c8' : t.glow

  return pts
    .map(([x, y], i) =>
      id === 'starfall'
        ? `<rect x="${x}" y="${y}" width="2" height="2" fill="${color}"><animate attributeName="y" values="${y};${(y ?? 0) + 60}" dur="${2 + (i % 3)}s" begin="${i * 0.4}s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0" dur="${2 + (i % 3)}s" begin="${i * 0.4}s" repeatCount="indefinite"/></rect>`
        : `<rect x="${x}" y="${y}" width="2" height="2" fill="${color}"><animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="${i * 0.3}s" repeatCount="indefinite"/></rect>`,
    )
    .join('')
}

// ---------- the room ----------

function torch(x: number, t: Theme, delay: string) {
  return `
  <circle class="night" cx="${x}" cy="30" r="26" fill="url(#glow-${t.id})" opacity="0.55">
    <animate attributeName="r" values="24;29;25;28;24" dur="1.6s" begin="${delay}" repeatCount="indefinite"/>
  </circle>
  <rect x="${x - 3}" y="34" width="6" height="14" fill="#5a3b22"/>
  <rect x="${x - 5}" y="32" width="10" height="3" fill="${t.trim}"/>
  <g transform="translate(${x} 32)"><g>
    <animateTransform attributeName="transform" type="scale" values="1 1;0.85 1.15;1.1 0.9;0.9 1.1;1 1" dur="0.9s" begin="${delay}" repeatCount="indefinite"/>
    <rect x="-4" y="-8" width="8" height="8" fill="${t.glow}"/>
    <rect x="-3" y="-12" width="6" height="5" fill="${t.flame}"/>
    <rect x="-2" y="-15" width="4" height="4" fill="${t.flame}"/>
    <rect x="-1" y="-6" width="2" height="5" fill="#fff8e0"/>
  </g></g>`
}

function windowAt(x: number) {
  return `
  <rect x="${x - 1}" y="16" width="20" height="30" class="frame"/>
  <rect x="${x + 1}" y="20" width="16" height="24" class="sky"/>
  <rect x="${x + 3}" y="18" width="12" height="2" class="sky"/>
  <rect x="${x + 4}" y="23" width="4" height="4" class="night" fill="#f4f1d0"/>
  <rect x="${x + 12}" y="30" width="1" height="1" class="night" fill="#fff"/><rect x="${x + 6}" y="37" width="1" height="1" class="night" fill="#fff"/>
  <rect x="${x + 10}" y="23" width="5" height="5" class="day" fill="#fff2a8"/>
  <rect x="${x + 8}" y="16" width="2" height="30" class="frame"/><rect x="${x - 1}" y="31" width="20" height="2" class="frame"/>
  <polygon class="day" points="${x + 1},44 ${x + 17},44 ${x + 40},96 ${x - 10},96" fill="#fff8d6" opacity="0.18"/>`
}

function particles(kind: Particle, color: string) {
  if (kind === 'none') return ''
  let out = ''
  for (let i = 0; i < 12; i++) {
    const x = (i * 53 + 17) % 320
    const dur = 3 + ((i * 7) % 5)
    const b = `${(i * 0.37).toFixed(2)}s`
    if (kind === 'snow') out += `<rect x="${x}" y="-4" width="2" height="2" fill="${color}" opacity="0.8"><animate attributeName="y" values="-4;100" dur="${dur}s" begin="${b}" repeatCount="indefinite"/></rect>`
    else if (kind === 'embers' || kind === 'bubbles') out += `<rect x="${x}" y="96" width="2" height="2" fill="${color}"><animate attributeName="y" values="96;10" dur="${dur}s" begin="${b}" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="${dur}s" begin="${b}" repeatCount="indefinite"/></rect>`
    else if (kind === 'stars') out += `<rect x="${x}" y="${(i * 29 + 5) % 60}" width="2" height="2" fill="${color}"><animate attributeName="opacity" values="0.1;1;0.1" dur="${dur}s" begin="${b}" repeatCount="indefinite"/></rect>`
    else if (kind === 'gears') {
      if (i % 3 === 0) out += `<g transform="translate(${x} ${20 + (i % 4) * 14})"><rect x="-3" y="-3" width="6" height="6" fill="none" stroke="${color}" stroke-width="1"><animateTransform attributeName="transform" type="rotate" values="0;360" dur="${dur + 4}s" repeatCount="indefinite"/></rect></g>`
    } else {
      const y = 30 + ((i * 23) % 55)
      out += `<circle cx="${x}" cy="${y}" r="${kind === 'wisps' ? 2.5 : 1.5}" fill="${color}"><animate attributeName="cx" values="${x};${x + 10};${x - 6};${x}" dur="${dur + 2}s" begin="${b}" repeatCount="indefinite"/><animate attributeName="opacity" values="0.2;1;0.3;0.2" dur="${dur}s" begin="${b}" repeatCount="indefinite"/></circle>`
    }
  }

  return out
}

/** The quest board on the wall: one note per open quest, red ones for bounties. */
function questBoard(quests: number, bounties: number, t: Theme) {
  let out = `<rect x="222" y="26" width="64" height="44" fill="#6b4423"/><rect x="225" y="29" width="58" height="38" fill="#b98a55"/>`
  out += `<rect x="236" y="20" width="36" height="7" fill="${t.accent}"/><rect x="238" y="22" width="32" height="1" fill="${t.trim}"/>`
  const notes = Math.min(8, quests)
  const reds = Math.min(4, bounties)
  for (let i = 0; i < notes + reds; i++) {
    const col = i % 4
    const row = Math.floor(i / 4) % 3
    const x = 228 + col * 14
    const y = 32 + row * 12
    const red = i >= notes
    out += `<rect x="${x}" y="${y}" width="10" height="9" fill="${red ? '#e9b3a8' : t.parchment}"/><rect x="${x + 4}" y="${y}" width="2" height="2" fill="${red ? '#b3261e' : '#555'}"/><rect x="${x + 2}" y="${y + 4}" width="6" height="1" fill="#0004"/>`
  }

  return out
}

function chest(relics: number, t: Theme) {
  const glow = relics > 0 ? `<circle cx="262" cy="95" r="14" fill="${t.glow}" opacity="0.18"><animate attributeName="opacity" values="0.1;0.3;0.1" dur="2.5s" repeatCount="indefinite"/></circle>` : ''

  return `${glow}<rect x="250" y="88" width="24" height="14" fill="#7a4a1f"/><rect x="250" y="86" width="24" height="5" fill="#9a5f28"/><rect x="250" y="91" width="24" height="2" fill="${t.trim}"/><rect x="260" y="92" width="4" height="4" fill="${t.trim}"/>`
}

export type Scene = {
  theme: Theme
  mode: 'auto' | 'day' | 'night'
  hat: string
  robe: string
  familiar: string
  aura: string
  quests: number
  bounties: number
  relics: number
  alt: string
}

export function hallSvg(s: Scene): string {
  const t = s.theme
  const night = { wall: t.wall, brick: t.brick, floor: t.floor, sky: '#1b2448', frame: '#4a3423' }
  const day = { wall: mix(t.wall, '#fff7e6', 0.5), brick: mix(t.brick, '#fff7e6', 0.35), floor: mix(t.floor, '#fff7e6', 0.35), sky: '#9fd8ff', frame: '#7a5533' }
  const rules = (scope: string, p: typeof night) =>
    (['wall', 'brick', 'floor', 'sky', 'frame'] as const).map(k => `svg.th-${t.id}.${scope} .${k}{fill:${p[k]}}`).join('')
  const css = `
    svg.night .day, svg.auto .day { display: none }
    svg.day .night { display: none }
    ${rules('night', night)}
    ${rules('day', day)}
    ${rules('auto', night)}
    @media (prefers-color-scheme: light) {
      ${rules('auto', day)}
      svg.auto .day { display: inline }
      svg.auto .night { display: none }
    }`

  return `<svg xmlns="http://www.w3.org/2000/svg" class="${s.mode} th-${t.id}" viewBox="0 0 320 120" width="640" height="240" shape-rendering="crispEdges" role="img" aria-label="${esc(s.alt)}">
  <style>${css}</style>
  <defs>
    <pattern id="bricks-${t.id}" width="20" height="10" patternUnits="userSpaceOnUse">
      <rect width="20" height="10" class="wall"/><rect width="20" height="1" class="brick"/>
      <rect width="1" height="5" class="brick"/><rect x="10" y="5" width="1" height="5" class="brick"/>
    </pattern>
    <radialGradient id="glow-${t.id}"><stop offset="0" stop-color="${t.glow}" stop-opacity="0.9"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="320" height="96" fill="url(#bricks-${t.id})"/>
  ${windowAt(110)}
  ${windowAt(194)}
  <rect y="96" width="320" height="24" class="floor"/><rect y="96" width="320" height="2" class="brick"/>
  <rect x="60" y="104" width="1" height="16" class="brick"/><rect x="150" y="100" width="1" height="20" class="brick"/><rect x="230" y="106" width="1" height="14" class="brick"/>
  <g class="night">${particles(t.particle, t.particleColor)}</g>
  ${torch(16, t, '0s')}
  ${torch(304, t, '0.4s')}
  <rect x="140" y="0" width="40" height="34" fill="${t.accent}"/><polygon points="140,34 160,44 180,34" fill="${t.accent}"/>
  <rect x="140" y="0" width="40" height="2" fill="${t.trim}"/><rect x="140" y="0" width="2" height="34" fill="${t.trim}"/><rect x="178" y="0" width="2" height="34" fill="${t.trim}"/>
  <rect x="159" y="7" width="2" height="20" fill="${t.trim}"/><rect x="154" y="11" width="12" height="2" fill="${t.trim}"/><rect x="158" y="27" width="4" height="3" fill="${t.trim}"/>
  ${questBoard(s.quests, s.bounties, t)}
  ${chest(s.relics, t)}
  ${aura(s.aura, t)}
  ${hero(t, s.hat, s.robe)}
  ${familiar(s.familiar)}
</svg>`
}

/** A small theme swatch for the Armory. */
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

/** A relic icon: a gem whose cut and color show its rarity. */
export function relicSvg(rarity: string, isFound: boolean): string {
  const c = !isFound ? '#9a9a9a' : rarity === 'legendary' ? '#ffb000' : rarity === 'epic' ? '#a066ff' : rarity === 'rare' ? '#2f8fff' : '#8a8a7a'
  const rows = ['..XXXX..', '.XLXXXX.', 'XXLXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..', '...XX...']

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 7" width="24" height="21" shape-rendering="crispEdges">${sprite(rows, { X: c, L: isFound ? '#ffffffaa' : c }, 0, 0, 1)}</svg>`
}

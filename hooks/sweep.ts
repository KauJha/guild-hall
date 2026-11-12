import type { EngineInterface } from 'claude-code'

import type { JiraQuest, PullRequest } from '../types'

// Everything here runs on your own machine with your own access:
// Jira through the Atlassian connector already connected to your Claude session,
// GitHub through the `gh` CLI you are signed in to. Nothing is hard-coded.

type Engine = EngineInterface

export type DoneTicket = { key: string; summary: string; type: string }
export type DonePr = { url: string; title: string }

export type JiraSweep = { quests: JiraQuest[]; done: DoneTicket[]; note: string; ok: boolean }
export type GithubSweep = { mine: PullRequest[]; toReview: PullRequest[]; merged: DonePr[]; reviewed: DonePr[]; note: string; ok: boolean }

// ---------- Jira ----------

type JiraLink = { server: string; cloudId: string }

function payloadOf(result: { content: ReadonlyArray<{ type: string; text?: string }>; structuredContent?: unknown }): any {
  if (result.structuredContent !== undefined && result.structuredContent !== null) return result.structuredContent
  const text = result.content.find(b => b.type === 'text')?.text ?? ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function call($: Engine, server: string, tool: string, args: Record<string, unknown>): Promise<any> {
  const result = await $.mcp.call(server, tool, args)
  if (result.isError) {
    const text = result.content.map(b => ('text' in b ? String((b as { text?: string }).text ?? '') : '')).join(' ')
    throw new Error(text.slice(0, 200) || 'the connector reported an error')
  }

  return payloadOf(result as never)
}

/** Atlassian servers this session can reach, best guesses first. */
async function atlassianServers($: Engine): Promise<string[]> {
  const found: string[] = []
  try {
    for (const t of await $.tool.list()) {
      if (t.mcp && /__searchJiraIssuesUsingJql$/.test(t.name)) {
        const server = t.name.split('__')[1]
        if (server && !found.includes(server)) found.push(server)
      }
    }
  } catch {
    // listing is best effort
  }
  // Rovo first: its result shape is the one parsed below most precisely.
  found.sort((a, b) => Number(/rovo/i.test(b)) - Number(/rovo/i.test(a)))
  for (const guess of ['claude.ai Atlassian Rovo', 'claude.ai Atlassian', 'Atlassian Rovo', 'Atlassian', 'atlassian']) {
    if (!found.includes(guess)) found.push(guess)
  }

  return found
}

async function linkJira($: Engine): Promise<JiraLink> {
  const saved = (await $.store.get('jira-link')) as JiraLink | undefined
  if (saved && typeof saved.server === 'string' && typeof saved.cloudId === 'string') return saved
  let lastError = 'No Atlassian connector found in this session.'
  for (const server of await atlassianServers($)) {
    try {
      const sites = await call($, server, 'getAccessibleAtlassianResources', {})
      const list: any[] = Array.isArray(sites) ? sites : Array.isArray(sites?.resources) ? sites.resources : []
      const site = list.find(s => Array.isArray(s?.scopes) && s.scopes.some((x: string) => /jira/.test(x))) ?? list[0]
      if (site?.id) {
        const link = { server, cloudId: String(site.id) }
        await $.store.set('jira-link', link)

        return link
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(lastError)
}

function issuesOf(payload: any): any[] {
  if (Array.isArray(payload?.issues?.nodes)) return payload.issues.nodes
  if (Array.isArray(payload?.issues)) return payload.issues
  if (Array.isArray(payload?.results)) return payload.results
  if (Array.isArray(payload)) return payload

  return []
}

const field = (n: any, k: string) => n?.fields?.[k] ?? n?.[k]
const nameOf = (x: any) => (typeof x === 'string' ? x : (x?.name ?? ''))

function toQuest(n: any): JiraQuest {
  const status = field(n, 'status')

  return {
    key: String(n?.key ?? ''),
    summary: String(field(n, 'summary') ?? ''),
    status: nameOf(status),
    category: String(status?.statusCategory?.key ?? n?.statusCategory ?? ''),
    type: nameOf(field(n, 'issuetype') ?? field(n, 'issueType')),
    priority: nameOf(field(n, 'priority')),
    url: String(n?.webUrl ?? n?.url ?? ''),
    updated: String(field(n, 'updated') ?? ''),
  }
}

export async function sweepJira($: Engine): Promise<JiraSweep> {
  let link: JiraLink
  try {
    link = await linkJira($)
  } catch (e) {
    return { quests: [], done: [], ok: false, note: `Jira not reached: ${e instanceof Error ? e.message : e}` }
  }
  const search = (jql: string, maxResults: number, fields: string[]) =>
    call($, link.server, 'searchJiraIssuesUsingJql', { cloudId: link.cloudId, jql, maxResults, fields, responseContentFormat: 'markdown' })
  try {
    const [open, done] = await Promise.all([
      search('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC', 50, ['summary', 'status', 'priority', 'issuetype', 'updated']),
      search('assignee = currentUser() AND statusCategory = Done AND resolved >= -30d ORDER BY resolved DESC', 100, ['summary', 'issuetype']),
    ])

    return {
      quests: issuesOf(open).map(toQuest).filter(q => q.key),
      done: issuesOf(done).map(toQuest).filter(q => q.key).map(q => ({ key: q.key, summary: q.summary, type: q.type })),
      ok: true,
      note: '',
    }
  } catch (e) {
    await $.store.delete('jira-link') // try discovery again next sweep
    return { quests: [], done: [], ok: false, note: `Jira search failed: ${e instanceof Error ? e.message : e}` }
  }
}

// ---------- GitHub (gh CLI) ----------

const GH_CANDIDATES = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']

async function findGh($: Engine): Promise<string | null> {
  const saved = (await $.store.get('gh-path')) as string | undefined
  const order = saved ? [saved, ...GH_CANDIDATES.filter(c => c !== saved)] : GH_CANDIDATES
  for (const bin of order) {
    try {
      const r = await $.process.run([bin, '--version'], { timeoutMs: 8000 })
      if (r.exitCode === 0) {
        if (bin !== saved) await $.store.set('gh-path', bin)

        return bin
      }
    } catch {
      // not here
    }
  }

  return null
}

const PR_FIELDS = `url title number isDraft updatedAt reviewDecision repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`

export function githubQuery(since: string): string {
  return `query {
  mine: search(query: "is:pr is:open author:@me archived:false", type: ISSUE, first: 30) { nodes { ... on PullRequest { ${PR_FIELDS} } } }
  review: search(query: "is:pr is:open review-requested:@me archived:false", type: ISSUE, first: 30) { nodes { ... on PullRequest { ${PR_FIELDS} } } }
  merged: search(query: "is:pr is:merged author:@me merged:>=${since}", type: ISSUE, first: 50) { nodes { ... on PullRequest { url title } } }
  reviewed: search(query: "is:pr reviewed-by:@me -author:@me updated:>=${since}", type: ISSUE, first: 50) { nodes { ... on PullRequest { url title } } }
}`
}

function toPr(n: any): PullRequest {
  return {
    url: String(n?.url ?? ''),
    title: String(n?.title ?? ''),
    repo: String(n?.repository?.nameWithOwner ?? ''),
    number: Number(n?.number ?? 0),
    isDraft: n?.isDraft === true,
    review: String(n?.reviewDecision ?? ''),
    checks: String(n?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? ''),
    updated: String(n?.updatedAt ?? ''),
  }
}

export function parseGithub(json: any): Omit<GithubSweep, 'note' | 'ok'> {
  const nodes = (k: string): any[] => (Array.isArray(json?.data?.[k]?.nodes) ? json.data[k].nodes.filter((x: any) => x?.url) : [])

  return {
    mine: nodes('mine').map(toPr),
    toReview: nodes('review').map(toPr),
    merged: nodes('merged').map((n: any) => ({ url: String(n.url), title: String(n.title ?? '') })),
    reviewed: nodes('reviewed').map((n: any) => ({ url: String(n.url), title: String(n.title ?? '') })),
  }
}

export async function sweepGithub($: Engine, nowMs: number): Promise<GithubSweep> {
  const empty = { mine: [], toReview: [], merged: [], reviewed: [] }
  const gh = await findGh($)
  if (!gh) return { ...empty, ok: false, note: 'GitHub not reached: the gh CLI was not found. Install it and run `gh auth login`.' }
  const since = new Date(nowMs - 30 * 86400000).toISOString().slice(0, 10)
  try {
    const r = await $.process.run([gh, 'api', 'graphql', '-f', `query=${githubQuery(since)}`], { timeoutMs: 45000 })
    if (r.exitCode !== 0) {
      const why = /auth|login|token/i.test(r.stderr) ? 'gh is not signed in. Run `gh auth login`.' : r.stderr.trim().slice(0, 160)

      return { ...empty, ok: false, note: `GitHub not reached: ${why}` }
    }

    return { ...parseGithub(JSON.parse(r.stdout)), ok: true, note: '' }
  } catch (e) {
    return { ...empty, ok: false, note: `GitHub not reached: ${e instanceof Error ? e.message : e}` }
  }
}

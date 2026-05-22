import { feedFetchJson } from './http.js';
import type { FeedItem, FeedPollResult, FeedSubLite } from './types.js';

interface GhRepo {
  full_name?: string;
  name?: string;
  description?: string | null;
  html_url?: string;
  stargazers_count?: number;
  owner?: { login?: string } | null;
}

// Star-count milestones to celebrate. Crossing any of these upward triggers
// exactly one embed per crossing in the polled window (typically one per
// poll because real repos don't add 50 stars in a minute).
const MILESTONES: readonly number[] = [10, 50, 100, 500, 1_000, 5_000, 10_000, 50_000, 100_000];

function formatMilestone(n: number): string {
  if (n >= 1_000) return `${n / 1_000}k`;
  return String(n);
}

function crossedMilestones(prev: number, current: number): number[] {
  if (current <= prev) return [];
  return MILESTONES.filter((m) => prev < m && m <= current);
}

export async function fetchGithubStarsFeed(sub: FeedSubLite): Promise<FeedPollResult> {
  const [owner, repo] = sub.identifier.split('/', 2);
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub identifier (need owner/repo): ${sub.identifier}`);
  }
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;

  const data = await feedFetchJson<GhRepo>(url, { accept: 'application/json', headers });
  const current = typeof data.stargazers_count === 'number' ? data.stargazers_count : 0;
  const latestId = `${current}`;

  if (!sub.lastItemId) {
    return { newItems: [], latestId };
  }
  const previous = Number.parseInt(sub.lastItemId, 10);
  if (!Number.isFinite(previous)) {
    return { newItems: [], latestId };
  }
  const crossings = crossedMilestones(previous, current);
  if (crossings.length === 0) {
    return { newItems: [], latestId };
  }

  const fullName = data.full_name ?? `${owner}/${repo}`;
  const repoUrl = data.html_url ?? `https://github.com/${owner}/${repo}`;
  const description = (data.description ?? '').trim();

  // Emit one item per crossed milestone — newest milestone first so the
  // scheduler can post oldest-first.
  const items: FeedItem[] = crossings
    .slice()
    .reverse()
    .map((m): FeedItem => {
      const item: FeedItem = {
        id: `${fullName}-stars-${m}`,
        title: `${fullName} just hit ${formatMilestone(m)} stars`,
        url: repoUrl,
        author: fullName,
        publishedAt: new Date(),
      };
      if (description) item.contentSnippet = description.slice(0, 300);
      return item;
    });

  return { newItems: items, latestId };
}

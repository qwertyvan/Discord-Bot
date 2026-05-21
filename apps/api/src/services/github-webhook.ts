/**
 * GitHub webhook payload → Discord embed renderer.
 *
 * Covers the most common events. Anything we don't have a renderer for is
 * passed through with a generic header so the channel still gets a signal.
 *
 * NB: GitHub signs the raw request body, not its re-serialized form. We
 * don't enforce signature verification here — the URL token is the
 * credential. If you want strong end-to-end verification, run a webhook
 * proxy (e.g. svix or smee) in front.
 */

interface GitHubRepository {
  full_name: string;
  html_url: string;
}

interface GitHubUser {
  login: string;
  avatar_url?: string;
  html_url?: string;
}

interface PushPayload {
  ref: string;
  repository: GitHubRepository;
  pusher: { name: string };
  commits: Array<{ id: string; message: string; url: string; author?: { name?: string } }>;
  compare: string;
  forced?: boolean;
}

interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    title: string;
    html_url: string;
    user: GitHubUser;
    body?: string | null;
    state: string;
    merged?: boolean;
    draft?: boolean;
  };
  repository: GitHubRepository;
}

interface IssuesPayload {
  action: string;
  issue: { number: number; title: string; html_url: string; user: GitHubUser; body?: string | null };
  repository: GitHubRepository;
}

interface ReleasePayload {
  action: string;
  release: { tag_name: string; name: string | null; html_url: string; body?: string | null; prerelease?: boolean };
  repository: GitHubRepository;
}

export interface GitHubEmbed {
  title: string;
  url?: string;
  description?: string;
  color: number;
  author?: { name: string; icon_url?: string; url?: string };
  footer?: { text: string };
}

const COLOR_DEFAULT = 0x5865f2;
const COLOR_OPEN = 0x238636;
const COLOR_MERGED = 0x8957e5;
const COLOR_CLOSED = 0xda3633;
const COLOR_DRAFT = 0x6e7681;

function authorBlock(user: GitHubUser): NonNullable<GitHubEmbed['author']> {
  return {
    name: user.login,
    ...(user.avatar_url ? { icon_url: user.avatar_url } : {}),
    ...(user.html_url ? { url: user.html_url } : {}),
  };
}

function truncate(s: string | null | undefined, n: number): string | undefined {
  if (!s) return undefined;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function renderGitHubEvent(event: string, payload: unknown): GitHubEmbed | null {
  if (!payload || typeof payload !== 'object') return null;

  switch (event) {
    case 'ping':
      return {
        title: '🏓 Webhook configured',
        description: 'GitHub successfully connected this webhook.',
        color: COLOR_DEFAULT,
      };

    case 'push': {
      const p = payload as PushPayload;
      const branch = p.ref?.replace(/^refs\/heads\//, '') ?? '';
      const lines = (p.commits ?? [])
        .slice(0, 8)
        .map((c) => `[\`${c.id.slice(0, 7)}\`](${c.url}) ${truncate(c.message.split('\n')[0], 80)} — ${c.author?.name ?? p.pusher.name}`)
        .join('\n');
      const more = p.commits.length > 8 ? `\n…and ${p.commits.length - 8} more` : '';
      return {
        title: `📦 ${p.repository.full_name} · ${p.commits.length} commit${p.commits.length === 1 ? '' : 's'} to ${branch}${p.forced ? ' (force-push)' : ''}`,
        url: p.compare,
        description: lines + more || '_no commit info_',
        color: COLOR_DEFAULT,
        author: { name: p.pusher.name },
        footer: { text: p.repository.full_name },
      };
    }

    case 'pull_request': {
      const p = payload as PullRequestPayload;
      const merged = p.pull_request.merged;
      const draft = p.pull_request.draft;
      const color = merged
        ? COLOR_MERGED
        : draft
          ? COLOR_DRAFT
          : p.pull_request.state === 'closed'
            ? COLOR_CLOSED
            : COLOR_OPEN;
      const verb =
        p.action === 'opened'
          ? '🟢 PR opened'
          : merged
            ? '🟣 PR merged'
            : p.action === 'closed'
              ? '🔴 PR closed'
              : p.action === 'reopened'
                ? '🟢 PR reopened'
                : `PR ${p.action}`;
      return {
        title: `${verb}: #${p.number} ${p.pull_request.title}`,
        url: p.pull_request.html_url,
        ...((d) => (d ? { description: d } : {}))(truncate(p.pull_request.body, 500)),
        color,
        author: authorBlock(p.pull_request.user),
        footer: { text: p.repository.full_name },
      };
    }

    case 'issues': {
      const p = payload as IssuesPayload;
      const color = p.action === 'closed' ? COLOR_CLOSED : COLOR_OPEN;
      const verb =
        p.action === 'opened'
          ? '🟢 Issue opened'
          : p.action === 'closed'
            ? '🔴 Issue closed'
            : p.action === 'reopened'
              ? '🟢 Issue reopened'
              : `Issue ${p.action}`;
      return {
        title: `${verb}: #${p.issue.number} ${p.issue.title}`,
        url: p.issue.html_url,
        ...((d) => (d ? { description: d } : {}))(truncate(p.issue.body, 500)),
        color,
        author: authorBlock(p.issue.user),
        footer: { text: p.repository.full_name },
      };
    }

    case 'release': {
      const p = payload as ReleasePayload;
      if (p.action !== 'published') return null;
      return {
        title: `🚀 Released ${p.release.name ?? p.release.tag_name}${p.release.prerelease ? ' (pre-release)' : ''}`,
        url: p.release.html_url,
        ...((d) => (d ? { description: d } : {}))(truncate(p.release.body, 1000)),
        color: COLOR_MERGED,
        footer: { text: p.repository.full_name },
      };
    }

    default:
      return {
        title: `${event} event from GitHub`,
        color: COLOR_DEFAULT,
      };
  }
}

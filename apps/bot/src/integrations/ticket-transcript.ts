import { type TextBasedChannel, type Message, Collection } from 'discord.js';

const MAX_MESSAGES = 1000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Walk the channel's message history (paginating by `before`) and render
 * an HTML transcript suitable for posting as an attachment. We cap at
 * 1,000 messages to bound memory + Discord API usage.
 */
export async function renderTranscript(
  channel: TextBasedChannel,
  meta: { title: string; openedAt: string; closedAt: string; closedBy?: string },
): Promise<string> {
  if (!('messages' in channel)) {
    return wrap(meta, '<p><em>This channel type doesn\'t support transcripts.</em></p>');
  }
  const all: Message[] = [];
  let before: string | undefined;
  while (all.length < MAX_MESSAGES) {
    const fetchOpts = before ? { limit: 100, before } : { limit: 100 };
    const batch: Collection<string, Message> = await channel.messages
      .fetch(fetchOpts)
      .catch(() => new Collection<string, Message>());
    if (batch.size === 0) break;
    all.push(...batch.values());
    const last = batch.last();
    if (!last) break;
    before = last.id;
    if (batch.size < 100) break;
  }
  // Oldest first.
  all.reverse();

  const rows = all
    .map((m) => {
      const ts = new Date(m.createdTimestamp).toISOString();
      const author = `${escapeHtml(m.author.tag)}${m.author.bot ? ' <span class="bot">[BOT]</span>' : ''}`;
      const content = m.content ? escapeHtml(m.content).replace(/\n/g, '<br>') : '';
      const attachments = m.attachments.size
        ? `<div class="atts">${[...m.attachments.values()]
            .map((a) => `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name ?? a.url)}</a>`)
            .join(' · ')}</div>`
        : '';
      return `<div class="msg"><div class="meta"><strong>${author}</strong> <span class="ts">${ts}</span></div><div class="body">${content || '<em>(no content)</em>'}</div>${attachments}</div>`;
    })
    .join('\n');

  return wrap(meta, rows);
}

function wrap(meta: { title: string; openedAt: string; closedAt: string; closedBy?: string }, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(meta.title)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #0f1115; color: #d8dadf; margin: 0; padding: 24px; }
  header { margin-bottom: 24px; border-bottom: 1px solid #2a2c34; padding-bottom: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta-line { color: #8a8e98; font-size: 13px; }
  .msg { padding: 10px 0; border-top: 1px solid #1c1e25; }
  .msg .meta { font-size: 13px; color: #8a8e98; margin-bottom: 4px; }
  .msg .meta strong { color: #ffffff; font-weight: 600; }
  .msg .body { font-size: 15px; white-space: pre-wrap; word-break: break-word; }
  .msg .atts { margin-top: 6px; font-size: 13px; }
  .bot { color: #5865f2; font-size: 11px; }
  a { color: #82a8ff; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(meta.title)}</h1>
  <div class="meta-line">Opened ${escapeHtml(meta.openedAt)} · Closed ${escapeHtml(meta.closedAt)}${meta.closedBy ? ` · by ${escapeHtml(meta.closedBy)}` : ''}</div>
</header>
${body}
</body>
</html>`;
}

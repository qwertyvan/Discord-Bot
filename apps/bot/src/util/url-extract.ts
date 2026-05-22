// URL extraction helpers for the link-safety scanner.
//
// `extractUrls` finds bare http(s) URLs in a message. The regex is intentionally
// permissive (don't try to be a full RFC 3986 parser) — the safety pipeline
// re-parses each match with `new URL()` and drops anything malformed.
const URL_PATTERN = /https?:\/\/[^\s<>"')(]+/gi;

export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(URL_PATTERN);
  if (!matches) return [];
  // Strip trailing punctuation a chatter might glue to the URL ("…example.com,").
  return matches.map((m) => m.replace(/[.,;:!?)]+$/, ''));
}

// Lowercase the hostname and drop a leading "www." so equality compares match
// what users expect ("Example.COM" → "example.com").
export function normalizeDomain(input: string): string {
  let host: string;
  try {
    host = new URL(input).hostname;
  } catch {
    host = input;
  }
  host = host.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

// True when `domain` equals `pattern` or is a subdomain of it. Both arguments
// must already be lowercase (callers typically pass the result of
// `normalizeDomain` for `domain`, and the DB-stored value for `pattern`).
export function domainMatches(domain: string, pattern: string): boolean {
  if (domain === pattern) return true;
  return domain.endsWith(`.${pattern}`);
}

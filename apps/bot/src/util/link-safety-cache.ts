import type { LinkSafetyConfig, LinkDomain } from '@discord-bot/shared';
import { api, ApiError } from '../api-client.js';
import { log } from '../logger.js';

const CONFIG_TTL_MS = 30_000;
const DOMAINS_TTL_MS = 60_000;

const configCache = new Map<string, { fetchedAt: number; cfg: LinkSafetyConfig | null }>();
const domainsCache = new Map<
  string,
  { fetchedAt: number; allow: Set<string>; block: Set<string> }
>();

export async function getLinkSafetyConfig(guildId: string): Promise<LinkSafetyConfig | null> {
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < CONFIG_TTL_MS) return cached.cfg;
  try {
    const cfg = await api.getEnabledLinkSafetyConfig(guildId);
    configCache.set(guildId, { fetchedAt: Date.now(), cfg });
    return cfg;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      configCache.set(guildId, { fetchedAt: Date.now(), cfg: null });
      return null;
    }
    log.warn('Failed to fetch link-safety config', { guildId, err: String(err) });
    return null;
  }
}

export async function getLinkDomains(
  guildId: string,
): Promise<{ allow: Set<string>; block: Set<string> }> {
  const cached = domainsCache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < DOMAINS_TTL_MS) {
    return { allow: cached.allow, block: cached.block };
  }
  try {
    const { domains } = await api.listLinkDomains(guildId);
    const allow = new Set<string>();
    const block = new Set<string>();
    for (const d of domains as LinkDomain[]) {
      (d.kind === 'allow' ? allow : block).add(d.domain.toLowerCase());
    }
    domainsCache.set(guildId, { fetchedAt: Date.now(), allow, block });
    return { allow, block };
  } catch (err) {
    log.warn('Failed to fetch link domains', { guildId, err: String(err) });
    return { allow: new Set(), block: new Set() };
  }
}

export function invalidateLinkSafetyCache(guildId: string): void {
  configCache.delete(guildId);
  domainsCache.delete(guildId);
}

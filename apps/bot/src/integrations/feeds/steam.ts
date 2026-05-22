import { feedFetchJson } from './http.js';
import type { FeedItem, FeedPollResult, FeedSubLite } from './types.js';

interface SteamPriceOverview {
  currency?: string;
  initial?: number; // cents
  final?: number; // cents
  discount_percent?: number;
  initial_formatted?: string;
  final_formatted?: string;
}

interface SteamAppData {
  name?: string;
  steam_appid?: number;
  price_overview?: SteamPriceOverview;
}

interface SteamAppDetails {
  success?: boolean;
  data?: SteamAppData;
}

type SteamResponse = Record<string, SteamAppDetails | undefined>;

function formatCents(cents: number, currency: string | undefined): string {
  const amount = (cents / 100).toFixed(2);
  if (currency) return `${amount} ${currency}`;
  return `$${amount}`;
}

/**
 * Steam doesn't expose a "price changed" feed, so we cache the last-seen
 * final price in `lastItemId` (cents, base-10 string) and emit only on
 * meaningful drops — ≥10% versus the previous poll. We also need price
 * details (not just price_overview) for the game name, so we fetch
 * without filters when the name isn't cached yet.
 */
export async function fetchSteamFeed(sub: FeedSubLite): Promise<FeedPollResult> {
  const appid = sub.identifier.trim();

  // Pull price + basic details. `filters=price_overview` keeps the payload
  // small, but we still need the name — Steam returns `name` regardless
  // when no filter is given. We always query without a filter and rely
  // on basic_info shape for the name.
  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(
    appid,
  )}&filters=basic,price_overview`;
  const json = await feedFetchJson<SteamResponse>(url, { accept: 'application/json' });
  const entry = json[appid];
  if (!entry?.success || !entry.data) {
    return { newItems: [], latestId: sub.lastItemId };
  }
  const data = entry.data;
  const price = data.price_overview;
  // No price — e.g. free or unreleased. Track latestId as 0 so a future
  // listing change still emits.
  if (!price || typeof price.final !== 'number') {
    return { newItems: [], latestId: '0' };
  }

  const currentCents = price.final;
  const latestId = `${currentCents}`;

  if (!sub.lastItemId) {
    return { newItems: [], latestId };
  }

  const previousCents = Number.parseInt(sub.lastItemId, 10);
  if (!Number.isFinite(previousCents) || previousCents <= 0) {
    return { newItems: [], latestId };
  }
  if (currentCents >= previousCents) {
    // Same or higher — record the new high but don't emit.
    return { newItems: [], latestId };
  }

  const dropPct = ((previousCents - currentCents) / previousCents) * 100;
  if (dropPct < 10) {
    return { newItems: [], latestId };
  }

  const name = data.name ?? `Steam app ${appid}`;
  const storeUrl = `https://store.steampowered.com/app/${encodeURIComponent(appid)}/`;
  const currency = price.currency;
  const currentFmt = price.final_formatted ?? formatCents(currentCents, currency);
  const previousFmt = formatCents(previousCents, currency);
  const discountPct = Math.round(dropPct);

  const item: FeedItem = {
    id: `${appid}-${currentCents}`,
    title: `${name} dropped ${discountPct}% to ${currentFmt}`,
    url: storeUrl,
    author: name,
    contentSnippet: `Was ${previousFmt} · now ${currentFmt} (-${discountPct}%)`,
    publishedAt: new Date(),
  };

  return { newItems: [item], latestId };
}

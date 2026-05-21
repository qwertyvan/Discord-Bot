import { Canvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { log } from '../../logger.js';

const WIDTH = 720;
const HEIGHT = 220;
const AVATAR_SIZE = 140;
const AVATAR_X = 40;
const AVATAR_Y = (HEIGHT - AVATAR_SIZE) / 2;
const TEXT_X = AVATAR_X + AVATAR_SIZE + 30;

export interface RankCardData {
  username: string;
  avatarUrl: string;
  level: number;
  rank: number | null;
  xp: number;
  currentLevelXp: number;
  nextLevelXp: number;
}

/**
 * Renders the rank card to a PNG buffer. Falls back to a flat background
 * (no avatar) if the avatar fails to load — we never throw, since this is
 * called on every /rank invocation.
 */
export async function renderRankCard(data: RankCardData): Promise<Buffer> {
  const canvas = new Canvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background gradient.
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, '#1e1f24');
  bg.addColorStop(1, '#2b2d35');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle accent line.
  ctx.fillStyle = '#5865F2';
  ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);

  // Avatar (circular crop).
  try {
    const avatar = await loadImage(data.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(AVATAR_X + AVATAR_SIZE / 2, AVATAR_Y + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();

    // Avatar ring.
    ctx.strokeStyle = '#5865F2';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(AVATAR_X + AVATAR_SIZE / 2, AVATAR_Y + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.stroke();
  } catch (err) {
    log.info('Avatar load failed for rank card', { err: String(err) });
  }

  // Username (large).
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText(truncate(data.username, 22), TEXT_X, AVATAR_Y + 36);

  // Stats line: Level / Rank.
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#b5b9c4';
  const rank = data.rank ? `Rank #${data.rank}` : 'Unranked';
  ctx.fillText(`Level ${data.level} · ${rank}`, TEXT_X, AVATAR_Y + 70);

  // XP progress bar.
  const barX = TEXT_X;
  const barY = AVATAR_Y + 90;
  const barW = WIDTH - barX - 40;
  const barH = 24;

  const span = Math.max(1, data.nextLevelXp - data.currentLevelXp);
  const into = Math.max(0, Math.min(span, data.xp - data.currentLevelXp));
  const pct = into / span;

  ctx.fillStyle = '#3a3c44';
  roundRect(ctx, barX, barY, barW, barH, 12);
  ctx.fill();
  ctx.fillStyle = '#5865F2';
  if (pct > 0) {
    roundRect(ctx, barX, barY, Math.max(barH, barW * pct), barH, 12);
    ctx.fill();
  }

  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#dfe1e7';
  const xpText = `${into.toLocaleString()} / ${span.toLocaleString()} XP`;
  const tw = ctx.measureText(xpText).width;
  ctx.fillText(xpText, barX + barW - tw, barY + barH + 18);

  // Total XP small footer.
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#7a7e8a';
  ctx.fillText(`Total: ${data.xp.toLocaleString()} XP`, barX, barY + barH + 18);

  return canvas.toBuffer('image/png');
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

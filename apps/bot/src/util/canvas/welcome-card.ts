import { Canvas, loadImage } from '@napi-rs/canvas';
import { log } from '../../logger.js';

const WIDTH = 900;
const HEIGHT = 280;
const AVATAR_SIZE = 180;
const AVATAR_X = (WIDTH - AVATAR_SIZE) / 2;
const AVATAR_Y = 26;

export interface WelcomeCardData {
  username: string;
  avatarUrl: string;
  serverName: string;
  memberCount: number;
  backgroundUrl?: string | null;
}

export async function renderWelcomeCard(data: WelcomeCardData): Promise<Buffer> {
  const canvas = new Canvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background — image if provided + reachable, else a gradient.
  let bgPainted = false;
  if (data.backgroundUrl) {
    try {
      const bg = await loadImage(data.backgroundUrl);
      // Cover the canvas, preserving aspect ratio.
      const scale = Math.max(WIDTH / bg.width, HEIGHT / bg.height);
      const dw = bg.width * scale;
      const dh = bg.height * scale;
      ctx.drawImage(bg, (WIDTH - dw) / 2, (HEIGHT - dh) / 2, dw, dh);
      // Darken so text stays readable.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      bgPainted = true;
    } catch (err) {
      log.info('Welcome card background load failed', { err: String(err) });
    }
  }
  if (!bgPainted) {
    const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    grad.addColorStop(0, '#1e1f24');
    grad.addColorStop(1, '#5865F2');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Avatar (circular).
  try {
    const avatar = await loadImage(data.avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(AVATAR_X + AVATAR_SIZE / 2, AVATAR_Y + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(AVATAR_X + AVATAR_SIZE / 2, AVATAR_Y + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.stroke();
  } catch (err) {
    log.info('Avatar load failed for welcome card', { err: String(err) });
  }

  // Welcome text.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 32px sans-serif';
  ctx.fillText(`Welcome, ${truncate(data.username, 24)}!`, WIDTH / 2, AVATAR_Y + AVATAR_SIZE + 28);

  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#dfe1e7';
  ctx.fillText(
    `to ${truncate(data.serverName, 32)}  ·  Member #${data.memberCount}`,
    WIDTH / 2,
    AVATAR_Y + AVATAR_SIZE + 54,
  );

  return canvas.toBuffer('image/png');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

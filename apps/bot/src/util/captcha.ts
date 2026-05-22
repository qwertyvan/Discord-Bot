import { Canvas } from '@napi-rs/canvas';

export interface MathChallenge {
  question: string;
  answer: string;
}

/**
 * A small math captcha — easy enough for a person to solve in a few seconds,
 * hard enough that a naive bot can't autosolve without a parser. Supports
 * +, -, and *.
 */
export function generateMathChallenge(): MathChallenge {
  const ops: Array<'+' | '-' | '*'> = ['+', '-', '*'];
  const op = ops[Math.floor(Math.random() * ops.length)] as '+' | '-' | '*';
  const a = Math.floor(Math.random() * 9) + 2;
  const b = Math.floor(Math.random() * 9) + 2;
  // Keep subtraction non-negative so the answer reads naturally.
  const lhs = op === '-' && b > a ? b : a;
  const rhs = op === '-' && b > a ? a : b;
  const value = op === '+' ? lhs + rhs : op === '-' ? lhs - rhs : lhs * rhs;
  return {
    question: `${lhs} ${op} ${rhs}`,
    answer: String(value),
  };
}

export interface ImageChallenge {
  pngBuffer: Buffer;
  answer: string;
  text: string;
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // excludes I/O/0/1 to reduce ambiguity

/**
 * Renders a 5-character alphanumeric captcha PNG with a noisy background and
 * jittered characters. The user reads it from a DM and submits via /verify.
 */
export function generateImageCaptcha(): ImageChallenge {
  const len = 5;
  let text = '';
  for (let i = 0; i < len; i++) {
    text += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }

  const W = 280;
  const H = 96;
  const canvas = new Canvas(W, H);
  const ctx = canvas.getContext('2d');

  // Noisy background.
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#1e1f24');
  bgGrad.addColorStop(1, '#2d3140');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Speckle dots.
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(${rand(120, 220)}, ${rand(120, 220)}, ${rand(120, 220)}, ${(Math.random() * 0.4 + 0.1).toFixed(2)})`;
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  // Wavy lines.
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = `rgba(${rand(150, 240)}, ${rand(150, 240)}, ${rand(150, 240)}, 0.5)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, Math.random() * H);
    for (let x = 0; x <= W; x += 10) {
      ctx.lineTo(x, H / 2 + Math.sin((x + i * 30) / 18) * (H / 4) + (Math.random() - 0.5) * 8);
    }
    ctx.stroke();
  }

  // Characters — jittered position, size, rotation.
  ctx.textBaseline = 'middle';
  const cellW = W / (len + 1);
  for (let i = 0; i < len; i++) {
    const ch = text[i] as string;
    const fontSize = rand(38, 50);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = `rgb(${rand(200, 255)}, ${rand(200, 255)}, ${rand(200, 255)})`;
    const x = cellW * (i + 1);
    const y = H / 2 + (Math.random() - 0.5) * 14;
    const angle = ((Math.random() - 0.5) * Math.PI) / 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillText(ch, -fontSize / 3, 0);
    ctx.restore();
  }

  return {
    pngBuffer: canvas.toBuffer('image/png'),
    answer: text.toLowerCase(),
    text,
  };
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

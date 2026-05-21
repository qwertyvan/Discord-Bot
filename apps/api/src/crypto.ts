import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard
const TAG_LENGTH = 16;
const VERSION = 'v1';

/**
 * Envelope-encrypts a plaintext string. Output format:
 *   `v1:<base64url(iv)>:<base64url(authTag)>:<base64url(ciphertext)>`
 *
 * `TOKEN_ENCRYPTION_KEY` must be 64 hex chars (32 bytes). It is loaded once
 * via env-validated config; callers pass it in so this module stays
 * test-friendly.
 */
export function encryptToken(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars).');

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LENGTH) throw new Error('Unexpected auth tag length.');

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(
    ':',
  );
}

/**
 * Decrypts a value produced by `encryptToken`. Throws on malformed input,
 * wrong key, or tampered ciphertext (the GCM auth tag verification fails).
 *
 * For backward compatibility with pre-v0.14 rows that stored raw tokens,
 * callers should fall back to treating undecodable values as plaintext —
 * see `decryptTokenOrPlaintext`.
 */
export function decryptToken(serialized: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars).');

  const parts = serialized.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Not an encrypted token envelope.');
  }
  const iv = Buffer.from(parts[1]!, 'base64url');
  const tag = Buffer.from(parts[2]!, 'base64url');
  const ct = Buffer.from(parts[3]!, 'base64url');
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error('Malformed token envelope.');
  }
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Read a token from storage: try envelope decryption, fall back to treating
 * the value as plaintext (for rows persisted before v0.14.0).
 */
export function decryptTokenOrPlaintext(stored: string, keyHex: string): string {
  if (stored.startsWith(`${VERSION}:`)) {
    return decryptToken(stored, keyHex);
  }
  return stored;
}

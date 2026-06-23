import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env';

// AES-256-GCM at-rest encryption for the user's GitHub OAuth token. The key is
// derived from SESSION_SECRET (sha256 → 32 bytes), so no extra env is required.
function key(): Buffer {
  return createHash('sha256').update(env.SESSION_SECRET || 'dev-insecure-secret').digest();
}

/** Encrypt → "ivB64:tagB64:cipherB64". Returns null for empty input. */
export function encryptToken(plain: string): string | null {
  if (!plain) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Decrypt the "iv:tag:cipher" form. Returns null on any malformed/forged input. */
export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(':');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts as [string, string, string];
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

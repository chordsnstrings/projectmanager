import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from './tokenCrypto';

describe('tokenCrypto', () => {
  it('round-trips a token', () => {
    const enc = encryptToken('gho_secrettoken123');
    expect(enc).toBeTruthy();
    expect(enc).not.toContain('gho_secrettoken123');
    expect(decryptToken(enc)).toBe('gho_secrettoken123');
  });

  it('returns null for empty / malformed / tampered input', () => {
    expect(encryptToken('')).toBeNull();
    expect(decryptToken(null)).toBeNull();
    expect(decryptToken('not-the-format')).toBeNull();
    const enc = encryptToken('abc')!;
    const [iv, , data] = enc.split(':');
    expect(decryptToken(`${iv}:AAAA:${data}`)).toBeNull(); // wrong auth tag
  });
});

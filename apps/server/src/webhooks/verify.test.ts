import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from './verify';

const secret = 'top-secret';
const body = JSON.stringify({ action: 'opened', number: 7 });
const validSig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('verifyWebhookSignature', () => {
  it('accepts a correct signature', () => {
    expect(verifyWebhookSignature(secret, body, validSig)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(secret, body + ' ', validSig)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(verifyWebhookSignature('other', body, validSig)).toBe(false);
  });

  it('rejects a malformed / missing header', () => {
    expect(verifyWebhookSignature(secret, body, undefined)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'nope')).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'sha256=deadbeef')).toBe(false);
  });

  it('rejects when secret is empty', () => {
    expect(verifyWebhookSignature('', body, validSig)).toBe(false);
  });
});

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a GitHub webhook signature (X-Hub-Signature-256), HMAC-SHA-256 over the
 * raw request body, using a constant-time compare. MUST run before parsing (§4).
 *
 * @param secret  the GITHUB_WEBHOOK_SECRET
 * @param rawBody the exact bytes/string of the request body
 * @param header  the value of the `X-Hub-Signature-256` header (e.g. "sha256=…")
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string | Buffer,
  header: string | undefined,
): boolean {
  if (!secret || !header) return false;
  if (!header.startsWith('sha256=')) return false;

  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // timingSafeEqual throws if lengths differ — guard first (length is not secret).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

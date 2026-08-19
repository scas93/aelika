import { randomBytes } from 'crypto';

/** 256 bits of CSPRNG entropy, hex-encoded — used for bot/API auth keys (not UUIDs). */
export function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

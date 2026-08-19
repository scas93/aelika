import { randomInt } from 'crypto';

// Excludes visually ambiguous characters (0/O, 1/l/I) since this password
// gets read and retyped by a human, not pasted from a password manager.
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateTemporaryPassword(length = 12): string {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += CHARSET[randomInt(CHARSET.length)];
  }
  return password;
}

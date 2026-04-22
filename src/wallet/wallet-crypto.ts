import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Derives a unique AES-256 key per user.
 * masterKey  — from WALLET_ENCRYPTION_KEY env (32 bytes)
 * salt       — userId (unique per row)
 * info       — email (additional context, changes if email changes)
 */
function deriveKey(masterKey: Buffer, userId: string, email: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey, userId, email, KEY_BYTES),
  );
}

export function encryptSecretKey(
  secretKey: Uint8Array,
  masterKey: Buffer,
  userId: string,
  email: string,
): string {
  const derived = deriveKey(masterKey, userId, email);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derived, iv);
  const encrypted = Buffer.concat([cipher.update(secretKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: hex(iv):hex(authTag):hex(ciphertext)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecretKey(
  stored: string,
  masterKey: Buffer,
  userId: string,
  email: string,
): Uint8Array {
  const [ivHex, tagHex, ctHex] = stored.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Invalid encrypted key format');

  const derived = deriveKey(masterKey, userId, email);
  const decipher = createDecipheriv(ALGORITHM, derived, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]);
  return new Uint8Array(decrypted);
}

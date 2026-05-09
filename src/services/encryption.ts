import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for GCM
const TAG_LENGTH = 16; // 128-bit auth tag
const KEY_LENGTH = 32; // 256-bit key

let encryptionKey: Buffer | null = null;

/**
 * Get or lazily initialize the encryption key.
 * Reads from PROVIDER_ENCRYPTION_KEY env var, or from data/.encryption_key file,
 * or auto-generates a new key and saves it.
 */
function getKey(): Buffer | null {
  if (encryptionKey) return encryptionKey;

  // 1. Try env var
  const envKey = process.env.PROVIDER_ENCRYPTION_KEY;
  if (envKey) {
    encryptionKey = Buffer.from(envKey, 'hex');
    return encryptionKey;
  }

  // 2. Try key file
  const dbPath = process.env.DB_PATH || './data/openclaw.db';
  const keyFile = path.join(path.dirname(path.resolve(dbPath)), '.encryption_key');

  if (fs.existsSync(keyFile)) {
    const stored = fs.readFileSync(keyFile, 'utf8').trim();
    if (stored) {
      encryptionKey = Buffer.from(stored, 'hex');
      return encryptionKey;
    }
  }

  // 3. Auto-generate and save
  encryptionKey = crypto.randomBytes(KEY_LENGTH);
  const dir = path.dirname(keyFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, encryptionKey.toString('hex'), { mode: 0o600 });
  return encryptionKey;
}

/**
 * Encrypt a plaintext string.
 * Returns a hex string: iv:tag:ciphertext
 * Returns null if input is null/empty.
 */
export function encrypt(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;

  const key = getKey();
  if (!key) return plaintext; // no key configured, store as-is

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a string that was encrypted by encrypt().
 * If the string doesn't match the encrypted format (iv:tag:ciphertext), returns as-is (plaintext fallback).
 */
export function decrypt(combined: string | null | undefined): string {
  if (!combined) return '';

  const key = getKey();
  if (!key) return combined; // no key, assume plaintext

  const parts = combined.split(':');
  if (parts.length !== 3) return combined; // not encrypted format, assume plaintext

  try {
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Decryption failed — assume it's plaintext (backward compat)
    return combined;
  }
}

/**
 * Check if a string appears to be encrypted (has iv:tag:ciphertext format).
 */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  return /^[0-9a-f]+$/i.test(parts[0]) && /^[0-9a-f]+$/i.test(parts[1]) && /^[0-9a-f]+$/i.test(parts[2]);
}

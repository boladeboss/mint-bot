/**
 * AES-256-GCM encryption for private key storage at rest.
 * Uses Node.js built-in crypto with scrypt key derivation.
 */

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import type { EncryptedKeystore } from '../types/wallet.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

// scrypt parameters (N=2^14 balances security vs speed for interactive use)
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/**
 * Derive an encryption key from a password using scrypt.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

/**
 * Encrypt a private key with AES-256-GCM.
 * Each call generates a unique IV and salt — never reuses.
 */
export function encrypt(privateKey: Buffer, password: string): EncryptedKeystore {
  const iv = randomBytes(IV_LENGTH);
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(privateKey), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    salt: salt.toString('hex'),
    authTag: authTag.toString('hex'),
    encryptedData: encrypted.toString('hex'),
    createdAt: Date.now(),
  };
}

/**
 * Decrypt a private key from an encrypted keystore.
 */
export function decrypt(keystore: EncryptedKeystore, password: string): Buffer {
  const iv = Buffer.from(keystore.iv, 'hex');
  const salt = Buffer.from(keystore.salt, 'hex');
  const authTag = Buffer.from(keystore.authTag, 'hex');
  const encryptedData = Buffer.from(keystore.encryptedData, 'hex');
  const key = deriveKey(password, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted;
}

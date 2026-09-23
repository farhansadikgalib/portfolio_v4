import { randomBytes, scrypt as deriveKey, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const scrypt = promisify(deriveKey);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export function validateCredentials(email, password) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid administrator email address.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Use a password between 12 and 256 characters.');
}

export async function atomicJSON(filename, value) {
  const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filename);
}

export async function readAccount(dataDir) {
  try {
    const value = JSON.parse(await readFile(join(dataDir, 'account.json'), 'utf8'));
    if (value.version !== 1 || typeof value.email !== 'string' || !/^[a-f0-9]{32}$/.test(value.salt) || !/^[a-f0-9]{128}$/.test(value.hash)) throw new Error('Administrator account data is invalid.');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function initializeAdminAccount({ dataDir, email, password, reset = false }) {
  validateCredentials(email, password);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const existing = await readAccount(dataDir);
  if (existing && !reset) throw new Error('An administrator already exists. Use --reset explicitly to replace the credentials.');
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS)).toString('hex');
  const account = { version: 1, email: email.trim().toLowerCase(), salt, hash, updatedAt: new Date().toISOString() };
  await atomicJSON(join(dataDir, 'account.json'), account);
  return { email: account.email };
}

export async function verifyPassword(account, password) {
  const validInput = typeof password === 'string' && password.length <= 256;
  const key = await scrypt(validInput ? password : '', account?.salt || '00000000000000000000000000000000', KEY_LENGTH, SCRYPT_OPTIONS);
  const expected = Buffer.from(account?.hash || '00'.repeat(KEY_LENGTH), 'hex');
  return timingSafeEqual(key, expected) && validInput && Boolean(account);
}

export function accountVersion(account) {
  return account ? createHash('sha256').update(account.hash).digest('hex') : '';
}

export function constantEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

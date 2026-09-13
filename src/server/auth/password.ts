import 'server-only';

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * `promisify` drops the options overload of `scrypt`, so this wrapper keeps the
 * cost parameters typed instead of casting them away.
 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing with scrypt (OWASP-recommended, built into Node — no native
 * build step and no third-party dependency in the credential path).
 *
 * Stored format: `scrypt$N$r$p$<salt base64>$<derived key base64>`.
 * The parameters live inside the hash so they can be raised later without
 * invalidating existing credentials.
 */

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// OWASP minimum for scrypt: N = 2^17, r = 8, p = 1.
const DEFAULT_COST = 2 ** 17;
const DEFAULT_BLOCK_SIZE = 8;
const DEFAULT_PARALLELISM = 1;

// scrypt needs roughly 128 · N · r bytes; Node's default limit is lower.
const MAX_MEMORY = 256 * DEFAULT_COST * DEFAULT_BLOCK_SIZE;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);

  const derivedKey = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: DEFAULT_COST,
    r: DEFAULT_BLOCK_SIZE,
    p: DEFAULT_PARALLELISM,
    maxmem: MAX_MEMORY,
  });

  return [
    'scrypt',
    DEFAULT_COST,
    DEFAULT_BLOCK_SIZE,
    DEFAULT_PARALLELISM,
    salt.toString('base64'),
    derivedKey.toString('base64'),
  ].join('$');
}

/**
 * Verify a password against a stored hash. Returns false (never throws) for a
 * malformed or absent hash, so callers cannot distinguish "no password set"
 * from "wrong password" through an exception.
 */
export async function verifyPassword(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  if (!storedHash) return false;

  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, costText, blockSizeText, parallelismText, saltText, keyText] = parts;

  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelism = Number(parallelismText);

  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelism)) {
    return false;
  }

  try {
    const salt = Buffer.from(saltText ?? '', 'base64');
    const expected = Buffer.from(keyText ?? '', 'base64');
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
      maxmem: Math.max(MAX_MEMORY, 256 * cost * blockSize),
    });

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Static audit of the data-access layer.
 *
 * The tenant guard catches an unscoped query at runtime, but only on a code
 * path a test happens to exercise. This suite reads the source instead, so a
 * newly added repository function is checked whether or not anything calls it.
 *
 * Two rules:
 *   1. Prisma is reachable from `src/server/db/` only. No page, component or
 *      action may query the database directly and bypass the repositories.
 *   2. Every query on a tenant-owned model in those repositories mentions
 *      `userId` within its call.
 */

const DB_DIR = join(process.cwd(), 'src', 'server', 'db');
const SRC_DIR = join(process.cwd(), 'src');

const TENANT_MODELS = ['client', 'invoice', 'invoiceItem', 'company'] as const;

function sourceFiles(dir: string, skip: string[] = []): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (skip.some((s) => path.includes(s))) continue;

    if (entry.isDirectory()) {
      found.push(...sourceFiles(path, skip));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }

  return found;
}

/**
 * Extract each `prisma.<model>.<operation>( … )` call with its arguments, by
 * scanning forward and balancing brackets.
 */
interface PrismaCall {
  file: string;
  model: string;
  operation: string;
  args: string;
  line: number;
}

function findPrismaCalls(file: string): PrismaCall[] {
  const source = readFileSync(file, 'utf8');
  const calls: PrismaCall[] = [];
  const pattern = /prisma\.(\w+)\.(\w+)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const [, model, operation] = match;
    const start = pattern.lastIndex;

    let depth = 1;
    let index = start;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '(' || char === '{' || char === '[') depth += 1;
      else if (char === ')' || char === '}' || char === ']') depth -= 1;
      index += 1;
    }

    calls.push({
      file,
      model: model ?? '',
      operation: operation ?? '',
      args: source.slice(start, index),
      line: source.slice(0, match.index).split('\n').length,
    });
  }

  return calls;
}

describe('データアクセス監査: Prisma はリポジトリ層からのみ', () => {
  it('no page, component, action or route queries Prisma directly', () => {
    const offenders = sourceFiles(SRC_DIR, ['src/generated', 'src/server/db'])
      .filter((file) => /\bprisma\.\w+\.\w+\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(process.cwd() + '/', ''));

    expect(offenders).toEqual([]);
  });

  it('only the repository layer imports the Prisma client', () => {
    const offenders = sourceFiles(SRC_DIR, ['src/generated', 'src/server/db'])
      .filter((file) => /from '\.\/prisma'|from '@\/server\/db\/prisma'/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(process.cwd() + '/', ''));

    expect(offenders).toEqual([]);
  });
});

describe('データアクセス監査: テナントスコープ', () => {
  const calls = sourceFiles(DB_DIR)
    .flatMap(findPrismaCalls)
    .filter((call) => (TENANT_MODELS as readonly string[]).includes(call.model));

  it('finds the repository queries it is meant to audit', () => {
    // A refactor that moved these elsewhere must not silently pass this suite.
    expect(calls.length).toBeGreaterThan(10);
  });

  it('every tenant-model query names userId', () => {
    const unscoped = calls
      .filter((call) => !/userId/.test(call.args))
      .map(
        (call) =>
          `${call.file.replace(process.cwd() + '/', '')}:${call.line} — prisma.${call.model}.${call.operation}`,
      );

    expect(unscoped).toEqual([]);
  });

  it('no bare findUnique by id on a tenant-owned model', () => {
    // `findUnique({ where: { id } })` is the shape that reads as correct and
    // returns another tenant's row.
    const bare = calls
      .filter(
        (call) =>
          call.operation.startsWith('findUnique') &&
          /where:\s*\{\s*id\s*[,:}]/.test(call.args) &&
          !/userId/.test(call.args),
      )
      .map((call) => `${call.file}:${call.line}`);

    expect(bare).toEqual([]);
  });
});

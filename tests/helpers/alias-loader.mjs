/**
 * Minimal resolver for the probe processes in tests/env-lazy.test.ts.
 *
 * Those probes run application modules in a bare Node process, which knows
 * nothing about the `@/*` path alias or extensionless TypeScript imports that
 * the bundler resolves. This hook supplies just enough of both to let a module
 * graph load, so the probe can observe whether importing it throws.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = pathToFileURL(`${process.cwd()}/src/`).href;

/** Try the bare path, then the TypeScript extensions a bundler would add. */
function firstExisting(href) {
  const candidates = [href, `${href}.ts`, `${href}.tsx`, `${href}/index.ts`, `${href}/index.tsx`];
  return candidates.find((candidate) => existsSync(fileURLToPath(candidate)));
}

export function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const resolved = firstExisting(new URL(specifier.slice(2), SRC).href);
    if (resolved) return next(resolved, context);
  }

  if (specifier.startsWith('.') && context.parentURL) {
    const resolved = firstExisting(new URL(specifier, context.parentURL).href);
    if (resolved) return next(resolved, context);
  }

  return next(specifier, context);
}

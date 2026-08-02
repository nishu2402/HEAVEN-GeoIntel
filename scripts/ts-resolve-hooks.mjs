/**
 * ESM resolve hook: let plain `node` follow this repo's extensionless imports.
 *
 * Source files are written for a bundler (`import { LOGO } from "./logo"`),
 * which Node's own resolver rejects — it wants the extension. Node strips
 * TypeScript types natively, so that one rule is the only thing standing
 * between `node` and running this codebase's modules directly.
 *
 * Rather than rewrite every import to suit a build script, or add a transpiler
 * dependency, retry a failed *relative* specifier with `.ts`, `/index.ts` and
 * `.tsx`. Only on failure — a specifier Node can already resolve is passed
 * through untouched, so this can never shadow a real module or a package.
 *
 * Synchronous on purpose: `module.registerHooks()` (the non-deprecated API)
 * runs hooks in-thread and requires sync functions.
 */

const CANDIDATES = [".ts", "/index.ts", ".tsx"];

export function resolve(specifier, context, nextResolve) {
  try {
    return nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith(".")) throw err;
    for (const suffix of CANDIDATES) {
      try {
        return nextResolve(specifier + suffix, context);
      } catch {
        // Try the next candidate; if none work, the original error is the
        // useful one — it names the specifier the author actually wrote.
      }
    }
    throw err;
  }
}

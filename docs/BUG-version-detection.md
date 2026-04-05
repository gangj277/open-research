# BUG: Version Detection Shows 0.0.0

## Status
Open — needs fix

## Symptom
When running the installed CLI (`npm install -g open-research`), the update checker reports:
```
Update available: 0.0.0 → 0.1.4. Run: npm update -g open-research
```

The current version shows as `0.0.0` instead of the actual installed version (e.g. `0.1.6`).

## Root Cause

The `getCurrentVersion()` function in `src/lib/cli/update-check.ts` cannot determine the installed package version at runtime.

### Why it fails

**Attempt 1: `process.env.npm_package_version`**
- This env var is only set when running via `npm run dev` or `npm start`
- When running the globally installed binary directly (`open-research`), this is `undefined`

**Attempt 2: Walk up from `__dirname` to find `package.json`**
- `__dirname` is undefined in ESM modules (we use `"type": "module"`)
- `import.meta.url` points to the bundled `dist/cli.js`, which is inside the npm global install at something like `/usr/local/lib/node_modules/open-research/dist/cli.js`
- The walk-up approach tries to find `package.json` by going up directories, but `tsup` bundles everything into a single `dist/cli.js` — the `__dirname` may not resolve correctly in all environments

**Attempt 3: The stale cache issue**
- `~/.open-research/update-check.json` caches the last check result
- If a check ran when version was `0.0.0`, that stale result persists for 4 hours
- Even after updating the binary, the cached `lastCheck` timestamp prevents a fresh check

## How It Should Work

The version should be **baked into the bundle at build time**, not read at runtime. This is what every production CLI does.

## Recommended Fix

### Option A: Inject version at build time via tsup (Recommended)

In `package.json`, update the build script:
```json
"build": "tsup src/cli.ts --format esm --clean --out-dir dist --define.PACKAGE_VERSION=\"\\\"$(node -p 'require(\"./package.json\").version')\\\"\"" 
```

Or use tsup's `define` option in a `tsup.config.ts`:
```typescript
import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  clean: true,
  outDir: "dist",
  define: {
    "process.env.PACKAGE_VERSION": JSON.stringify(pkg.version),
  },
});
```

Then in `update-check.ts`:
```typescript
function getCurrentVersion(): string {
  return process.env.PACKAGE_VERSION ?? "0.0.0";
}
```

This injects the literal version string into the bundle at compile time. No runtime file reading needed. Works in every environment.

### Option B: Use createRequire to read package.json at runtime

```typescript
import { createRequire } from "node:module";

function getCurrentVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json"); // relative to dist/cli.js
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}
```

This works in ESM because `createRequire` allows `require()` calls from ESM modules. The path `../package.json` is relative to `dist/cli.js` — and `package.json` is at the package root, one level up from `dist/`.

### Option C: Generate a version file at build time

Add a prebuild script:
```json
"prebuild": "node -e \"require('fs').writeFileSync('src/version.ts', 'export const VERSION = \\\"' + require('./package.json').version + '\\\";\\n')\""
```

Then import it:
```typescript
import { VERSION } from "./version";
```

## Additional Fix: Clear stale cache

The update check cache at `~/.open-research/update-check.json` should be invalidated when the installed version changes. Currently it caches for 4 hours regardless.

Add version to the cache key:
```typescript
interface UpdateState {
  lastCheck: number;
  latestVersion: string | null;
  checkedFromVersion: string; // NEW: invalidate when this changes
}
```

## Files to Modify

1. `src/lib/cli/update-check.ts` — `getCurrentVersion()` function
2. `package.json` or `tsup.config.ts` — build-time version injection (if using Option A)
3. `~/.open-research/update-check.json` — schema update (if adding cache invalidation)

## Test Plan

1. Build: `npm run build`
2. Install globally: `npm install -g .`
3. Run: `open-research`
4. Verify version shows correctly in update check message
5. Verify `/cost` or any version-displaying command shows the right version
6. Delete `~/.open-research/update-check.json` and re-run to test fresh check

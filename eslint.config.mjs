// ── ESLint 10 flat config (required by eslint-config-next 16) ───────────────
// eslint-config-next 16 ships native flat configs, so we import + spread them
// directly (no FlatCompat shim). Same rule set as the old .eslintrc.json
// ("next/core-web-vitals" + "next/typescript").

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "scripts/**",        // shell-runner / puppeteer helper, not app code
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // `react-hooks/set-state-in-effect` (new in the React-Compiler-era
      // react-hooks plugin) flags the React-endorsed "load persisted / async
      // data on mount" pattern (localStorage hydration, QR generation, fetching
      // saved cases). These are correct uses of effects per the React docs, so
      // we keep them as warnings rather than build-breaking errors.
      "react-hooks/set-state-in-effect": "warn",

      // next/typescript ships `@typescript-eslint/no-unused-vars` as "warn", and
      // `npm run lint` has no --max-warnings 0, so an unused variable would never
      // fail lint or CI. Make it an error so dead variables cannot accumulate
      // silently. `_`-prefixed names and rest siblings stay allowed: the usual
      // escape hatch for a deliberately unused param, binding or caught error.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
    },
  },
];

export default eslintConfig;

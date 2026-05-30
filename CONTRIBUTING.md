# Contributing to HEAVEN-GeoIntel

Thanks for considering a contribution. This project is built and maintained
by individuals on their own time — please be patient with reviews.

## Quick start

Requires **Node.js 20.9+** (Next.js 16).

```bash
git clone https://github.com/nishu2402/HEAVEN-GeoIntel.git
cd HEAVEN-GeoIntel
npm install
npm run dev          # http://localhost:3000
npm test             # Vitest
npm run lint         # ESLint 9 (flat config)
npm run typecheck    # tsc --noEmit
```

## Ground rules

- **No fake data.** Every value rendered must come from libphonenumber,
  a bundled dataset, or a live API. Never render "N/A" or guess a value to
  fill a card — render nothing instead. For ambiguous results (e.g. a username
  site that blocks our check), show an honest "UNVERIFIED" state rather than a
  false positive.
- **No real-time tracking.** This tool returns metadata only. Pull requests
  that add live GPS, SS7, or interception capabilities will be closed.
- **TypeScript strict.** All new code must type-check with no `any`
  escape-hatches unless there is a written justification in a comment.
- **Mobile-first.** Test new UI at 360px before 1280px.

## Pull-request checklist

Before opening a PR:

- [ ] `npm run lint` passes
- [ ] `node node_modules/typescript/bin/tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] `node node_modules/next/dist/bin/next build` passes
- [ ] Screenshots attached for UI changes
- [ ] No new third-party data source without an entry in README's data-sources table
- [ ] No personal data in commits (test phone numbers should be `+14155552671` / `+14155552672` — Twilio's public test numbers)

## Adding a new OSINT data source

1. Add the fetch helper in the relevant route under `src/app/api/`
   (`lookup` phone · `email-lookup` · `username-lookup` · `ip-lookup` ·
   `domain-lookup`).
2. Add the response shape to `src/lib/types.ts`.
3. Add a panel under `src/components/<feature>/` if the data warrants its own
   card, or extend an existing panel for a single signal.
4. Update the README's data-sources / tech-stack tables and the OpenAPI spec
   in `src/app/api/docs/route.ts`.
5. If the source needs a key, document it in `.env.example`.
6. If the source has a free tier, add it to the OSINT Pivot Matrix
   (`src/components/osint/OsintPivots.tsx`) with the correct access badge.
7. Validate user input **before** any outbound request and only interpolate it
   into a fixed host (no SSRF) — follow the existing routes' pattern.

## Adding a new OSINT pivot link

In `src/components/osint/OsintPivots.tsx`, add an entry with:

- The exact URL that produces a result page (not a homepage)
- `access: "free" | "captcha" | "login" | "paid"` — verify by clicking
  in an incognito window
- A one-line description
- `usOnly: true` if the site only covers US numbers

If a link 404s or just redirects to a homepage, do **not** add it. We'd
rather show 30 working links than 80 links of which half are dead.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(pivots): add OSINT Industries to identity category
fix(api): handle Hudson Rock 429 response correctly
docs(readme): clarify Docker setup steps
chore(deps): bump next to the latest patch release
```

## Code of conduct

By participating you agree to the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## Licensing

By contributing you agree that your contributions will be licensed under the
[MIT License](./LICENSE) plus the OSINT acceptable-use policy in the same file.

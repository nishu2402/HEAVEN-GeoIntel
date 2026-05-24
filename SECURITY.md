# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a vulnerability

If you believe you have found a security vulnerability in HEAVEN-GeoIntel,
please report it privately so it can be fixed before public disclosure.

**Preferred channel:** open a [GitHub Security Advisory](https://github.com/nishu2402/HEAVEN-GeoIntel/security/advisories/new)
on this repository. GitHub will keep the report private until a fix is ready.

**Email fallback:** if GitHub is unavailable to you, email the maintainers at
the address listed on the [project's GitHub profile](https://github.com/nishu2402).
Please prefix the subject with `[SECURITY]`.

When reporting, include:

1. A clear description of the issue and the impact.
2. Steps to reproduce — the smallest possible PoC.
3. The version / commit SHA you tested against.
4. Your suggested fix, if you have one.

You should receive an acknowledgement within **72 hours**. If the issue is
confirmed, we aim to ship a fix within **14 days** for critical issues and
**30 days** for lower-severity issues.

## Scope

In scope:

- The Next.js application itself (`app/`, `components/`, `lib/`).
- The Docker image (`Dockerfile`, `docker-compose.yml`).
- The API routes (`/api/lookup`, `/api/email-lookup`, etc.).

Out of scope (please report these to the upstream maintainers):

- Vulnerabilities in upstream npm packages (use `npm audit` / Dependabot).
- Issues with third-party OSINT services we link out to (Truecaller, Hudson
  Rock, etc.). Report to those services directly.

## Coordinated disclosure

We follow a 90-day coordinated-disclosure timeline. If a vulnerability cannot
be remediated within 90 days, the reporter and the maintainers will agree on
an extended deadline before any public details are shared.

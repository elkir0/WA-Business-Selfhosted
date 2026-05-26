# Contributing to WA-Business-Selfhosted

Thanks for your interest. This project is built and maintained for the selfhosted community; contributions are welcome under the conditions below.

## License agreement

By contributing, you agree that your contributions are licensed under the **AGPL-3.0** like the rest of the project. We do not require a CLA but you must have the right to contribute the code you submit.

## Ground rules

- **Scope discipline**: this is a WhatsApp Business Cloud API gateway with an admin UI. Features outside that scope (e.g., multi-platform messaging, multi-tenant SaaS, marketplace plugins) are not goals and PRs adding them will be closed.
- **No secrets in PRs**: pre-commit gitleaks is your safety net but you should also `git diff` carefully. Any leaked secret in a PR triggers a force-rewrite of history before merge.
- **Backwards compatibility**: pre-1.0 we may break APIs between minor versions. From 1.0 onwards, breaking changes go to a major version.

## How to propose a change

1. **Open an issue first** for anything non-trivial (new feature, behavior change, refactor). For bugfix PRs of <30 lines, you can skip the issue.
2. Fork the repo and create a topic branch: `git checkout -b feat/short-description`.
3. Make small, focused commits. Commit messages follow Conventional Commits (`feat:`, `fix:`, `doc:`, `chore:`, `refactor:`, `test:`).
4. Add or update tests for any behavior change. The CI must pass.
5. Open a PR against `main`. Fill out the PR template.

## Development setup

(Filled in Phase 1 once we have an actual `package.json` and toolchain.)

## What gets merged

We optimize for *fewer, well-thought-out features* rather than breadth. Things likely to be merged:

- Bug fixes with reproducer
- Documentation improvements
- Performance improvements with measurements
- New `SMSProvider` drivers (Twilio is the reference, others welcome in `examples/sms-providers/`)
- New plugins behind clear env-var gating

Things likely to be declined:

- Adding dependencies for marginal value
- UI restyles that break the established palette/typography
- Hard-coding any business logic (the gateway is meant to stay generic)

## What is not in scope

- A managed/hosted version of this software
- WhatsApp Web automation, browser scraping, or unofficial API wrappers — this project only uses the official Cloud API
- Marketing / growth features (sequences, campaigns) — outside scope; build on top via the API

## Code of conduct

Be kind. Default to good faith. Personal attacks, harassment, or discriminatory language is grounds for ban from the repo.

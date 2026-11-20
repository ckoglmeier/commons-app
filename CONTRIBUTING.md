# Contributing to Commons

Thanks for helping. Commons is a small project, so issues and focused pull requests work best.

## Before you start

- Open an issue first for anything bigger than a bug fix, so we can agree on the approach.
- Read `DESIGN.md` before changing any screen, component or wording. It is the design and interaction contract.
- Keep changes mobile-first. Check every changed screen at 390 and 430 pixels wide.

## Making a change

1. Fork the repository and create a branch.
2. `npm ci`, then copy `.env.example` to `.env.local`. For local work you can use the local test sign-in described in `docs/self-hosting.md`.
3. Run `npm run typecheck`, `npm run lint` and `npm test` before you open a pull request. Database tests need a disposable Postgres whose database name ends in `_test`.
4. Use synthetic people and trips in tests and screenshots. Never commit real names, emails, phone numbers or keys.

## Licensing and sign-off

Code and documentation you contribute are licensed under the MIT License, the same as the rest of the project. Add a sign-off line to each commit (`git commit -s`) to confirm you wrote the change or have the right to submit it under that license, as described by the [Developer Certificate of Origin](https://developercertificate.org/).

The Commons name and cover artwork are reserved (see `NOTICE.md`). Please don't contribute drawings or other artwork unless asked.

## Security

Don't report security problems in a public issue. See `SECURITY.md`.

# Commons repository instructions

## Product interface

- Read `DESIGN.md` completely before changing any user-facing screen, component, visual token, or interaction copy.
- Treat `DESIGN.md` as the canonical visual and interaction contract. If a new requirement conflicts with it, update the system deliberately instead of creating a one-off exception.
- Build mobile-first, with 390px and 430px widths as required checks.
- Preserve the distinction between human participants, Commons, and future personal agents.
- Keep chat as an interface to shared state, not the primary web information architecture.
- Do not imply booking, payments, external calendar access, automatic plan mutation, or agent authority that the current release does not support.
- Consequential Commons proposals require visible provenance, explicit scope, and human approval.

## Implementation

- Shared production tokens belong in `packages/ui/src/tokens.css`.
- Prefer reusable semantic tokens and primitives over route-specific values.
- Use real buttons and links, 44px minimum targets, visible focus states, WCAG AA contrast, and reduced-motion handling.
- Treat `apps/web` as the only web application.

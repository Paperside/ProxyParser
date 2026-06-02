# ProxyParser Agent Notes

This repository is being redesigned into a multi-user Mihomo extended subscription workspace.

Current preferred direction: keep the existing Bun/Elysia/SQLite/React foundation and refactor the product model around:

```text
external subscription + operation template/draft operation flow + publication settings = extended subscription
```

Useful commands:

- Root typecheck: `bun run typecheck`
- Backend tests: `cd backend && bun test`
- Frontend dev server: `bun run dev:frontend`
- Backend dev server: choose a non-conflicting `PORT`; avoid ports `3001` and `7001` when possible because the user may need them.

Important local context:

- Approved product redesign spec: `docs/superpowers/specs/2026-05-14-proxyparser-product-redesign-design.md`
- Product/design draft: `docs/proxyparser-redesign-draft.md`
- Existing technical plan: `docs/technical-plan.md`
- Existing task tracker: `docs/TODO.md`
- User-provided subscription sample is cached under `backend/data/mock-subscriptions/`, which is ignored by git and may contain real nodes. Do not commit or print its contents.

Implemented in the current redesign branch:

- Draft preview/publish/render replays the latest successful upstream snapshot.
- Auto grouping is wired into draft and template render paths.
- Rule provider attachments generate matching `rule-providers` and `RULE-SET` rules.
- Render failures are persisted as degraded subscription status.
- Temp subscription tokens support TTL bounds, listing, and immediate revoke.
- Drafts can import pasted subscription URLs directly.
- Drafts can extract sanitized templates that omit real nodes.
- Extended subscriptions expose short key, long key, and share-grant controls in the UI.

Known follow-up gaps:

- Template-center UI can show shareability, but it does not yet provide a one-click sanitize action for an existing source-locked template.
- Share grants are manageable by owner; recipient-side discovery/notification can be made richer later.
- Frontend bundle size still triggers Vite's default 500 kB warning; code splitting is a future polish task.

Mihomo notes:

- Rule order is behavior; preserve and expose insertion position.
- `RULE-SET,name,policy` requires a matching `rule-providers.name`.
- Rule provider `behavior` should be tracked as `domain`, `ipcidr`, or `classical`.
- Auto grouping should support node-name regex classification and manual correction for unclassified nodes.

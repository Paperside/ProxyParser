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

Known high-priority gaps:

- Draft preview/publish/pull can replay an old selected upstream snapshot instead of the latest successful snapshot.
- Template rendering does not currently consume `ruleProviderRefs`, so generated `RULE-SET` rules can reference missing `rule-providers`.
- The country/region auto-grouping logic exists in the old patcher path but is not wired into the generated subscription draft/render path.
- Render failures are not persisted to subscription status even though repository support exists.
- Temp subscription tokens need TTL bounds and an immediate revoke API.

Mihomo notes:

- Rule order is behavior; preserve and expose insertion position.
- `RULE-SET,name,policy` requires a matching `rule-providers.name`.
- Rule provider `behavior` should be tracked as `domain`, `ipcidr`, or `classical`.
- Auto grouping should support node-name regex classification and manual correction for unclassified nodes.

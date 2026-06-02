# ProxyParser Product Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable V1 Mihomo extended subscription workspace where users import external subscriptions, auto-group nodes, attach synced rule sources, save/share sanitized templates, publish extended subscriptions, and manage long/short subscription keys.

**Architecture:** Preserve the current Bun/Elysia/SQLite/React monorepo. Add focused backend primitives for render operations, auto grouping, rule-provider attachment, template sanitization, sharing, and temp-token revocation; then rework the frontend around an extended-subscription workflow without replacing the entire stack.

**Tech Stack:** Bun, Elysia, SQLite migrations, TypeScript, React, Vite, js-yaml, lucide-react, Radix UI components.

**Current status (2026-05-14):** Backend product primitives, frontend extended-subscription workflow, sanitized template extraction, share grants, and short/long key controls are implemented. Verification passed with `cd backend && bun test`, `cd frontend && bun run build`, and an in-browser happy-path QA flow using a local mock subscription source.

---

## File Structure

- `backend/migrations/0005_product_redesign.sql`: add template shareability metadata, subscription share grants, temp-token labels/revocation indexes, and optional draft render preferences.
- `backend/src/types.ts`: extend shared backend domain types for rule-provider attachment, auto grouping, template shareability, share targets, and temp-token records.
- `backend/src/lib/render/auto-groups.ts`: classify proxy nodes and generate `Proxies` plus region groups.
- `backend/src/lib/render/rule-provider-render.ts`: turn selected rulesets into `rule-providers` entries and `RULE-SET` rules.
- `backend/src/lib/render/template-sanitizer.ts`: strip real proxy nodes and source-bound secrets from templates.
- `backend/src/lib/render/render-managed-config.ts`: consume rule provider refs and auto-group options in template mode.
- `backend/src/modules/generated-subscription-drafts/draft-operations.ts`: consume auto-group and rule-provider operations in draft mode.
- `backend/src/modules/generated-subscription-drafts/generated-subscription-draft.service.ts`: use latest snapshots for publish/pull preview, expose source import in draft creation, and extract sanitized templates.
- `backend/src/modules/subscriptions/subscription-access.repository.ts`: list and revoke temp tokens.
- `backend/src/modules/subscriptions/managed-subscription.repository.ts`: persist render failures and expose pull/key/share details.
- `backend/src/modules/subscriptions/managed-subscription.service.ts`: enforce temp-token TTL bounds, revoke temp tokens, render failures, and sharing.
- `backend/src/modules/subscriptions/routes.ts`: add temp-token list/revoke and share endpoints.
- `backend/src/modules/upstream-sources/upstream-source.service.ts`: sync on create/update URL and validate URL updates.
- `backend/src/modules/templates/template.repository.ts`: persist template shareability and sanitized attribution.
- `backend/src/modules/templates/template.service.ts`: enforce share/fork semantics and create sanitized templates.
- `backend/tests/integration.test.ts`: add end-to-end tests for latest snapshot rendering, auto groups, rule providers, render failure persistence, token revocation, and sanitized templates.
- `frontend/src/lib/types.ts`: mirror backend response types.
- `frontend/src/providers/workspace-provider.tsx`: add APIs for source import, temp-token list/revoke, share settings, sanitized template extraction.
- `frontend/src/components/app-shell.tsx`: rename product areas and navigation around extended subscriptions.
- `frontend/src/pages/dashboard-page.tsx`: make the workbench first screen.
- `frontend/src/pages/subscriptions-page.tsx`: split external and extended subscription management with richer status and key actions.
- `frontend/src/pages/generated-subscription-wizard-page.tsx`: rework wizard into source import, node grouping, rule attach, group edit, settings, preview/publish.
- `frontend/src/pages/templates-page.tsx`: show shareability, source lock reasons, sanitized export actions.
- `frontend/src/pages/settings-page.tsx`: show key and audit activity without making it the primary key UI.
- `frontend/src/styles.css`: product-level visual refresh.

## Task 1: Backend Migration And Types

**Files:**
- Create: `backend/migrations/0005_product_redesign.sql`
- Modify: `backend/src/types.ts`
- Modify: `frontend/src/lib/types.ts`

- [ ] **Step 1: Write failing migration/type coverage test**

Add a test in `backend/tests/integration.test.ts` named `product redesign migration exposes shareability and token metadata`. It should create an in-memory context, query `PRAGMA table_info(templates)`, `PRAGMA table_info(user_subscription_temp_tokens)`, and `sqlite_master` for `subscription_share_grants`, then expect:

```ts
expect(templateColumns).toContain("shareability_status");
expect(templateColumns).toContain("sanitized_from_template_id");
expect(tempTokenColumns).toContain("label");
expect(tempTokenColumns).toContain("revoked_at");
expect(shareGrantTable).toBeTruthy();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "product redesign migration"`

Expected: FAIL because the new columns/table do not exist.

- [ ] **Step 3: Add migration**

Create `backend/migrations/0005_product_redesign.sql`:

```sql
ALTER TABLE templates
  ADD COLUMN shareability_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (shareability_status IN ('unknown', 'shareable', 'source_locked', 'sanitized'));

ALTER TABLE templates
  ADD COLUMN sanitized_from_template_id TEXT REFERENCES templates(id) ON DELETE SET NULL;

ALTER TABLE templates
  ADD COLUMN locked_reasons_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE user_subscription_temp_tokens
  ADD COLUMN label TEXT;

CREATE TABLE IF NOT EXISTS subscription_share_grants (
  id TEXT PRIMARY KEY,
  managed_subscription_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  target_user_id TEXT,
  target_email TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('user', 'public', 'unlisted')),
  mode TEXT NOT NULL CHECK (mode IN ('view', 'fork', 'subscribe')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (managed_subscription_id) REFERENCES managed_subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_share_grants_subscription_id
  ON subscription_share_grants(managed_subscription_id);

CREATE INDEX IF NOT EXISTS idx_subscription_share_grants_target_user_id
  ON subscription_share_grants(target_user_id);
```

- [ ] **Step 4: Extend types**

Add backend/frontend types:

```ts
export type TemplateShareabilityStatus = "unknown" | "shareable" | "source_locked" | "sanitized";
export type SubscriptionShareScope = "user" | "public" | "unlisted";
export type SubscriptionShareGrantMode = "view" | "fork" | "subscribe";

export interface RuleProviderAttachment {
  type: "attach-rule-provider";
  providerSlug: string;
  targetPolicy: string;
  insert: { position: "top" | "bottom" | "before-match" };
}

export interface AutoGroupOptions {
  enabled: boolean;
  includeAutoGroup: boolean;
  unclassifiedPolicy: "others" | "ignore";
}
```

Extend `TemplateSummary`/`Template` with `shareabilityStatus`, `sanitizedFromTemplateId`, and `lockedReasons`.

- [ ] **Step 5: Run tests**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "product redesign migration"`

Expected: PASS.

## Task 2: Auto Group Rendering

**Files:**
- Create: `backend/src/lib/render/auto-groups.ts`
- Modify: `backend/src/modules/generated-subscription-drafts/draft-operations.ts`
- Modify: `backend/src/lib/render/render-managed-config.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write failing auto-group test**

Add test `draft preview auto groups all source nodes into Proxies and regions`. Seed a source with `HK-01`, `JP-01`, `Mystery-01`, save a `groups_rules` step with:

```ts
operations: {
  autoGroup: { enabled: true, includeAutoGroup: true, unclassifiedPolicy: "others" }
}
```

Expect preview document to include groups named `Proxies`, `HK`, `JP`, `Others`, and `Auto`; `Proxies.proxies` contains all node names and region groups; `Others.proxies` contains `Mystery-01`.

- [ ] **Step 2: Verify red**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "auto groups"`

Expected: FAIL because draft operations ignore `autoGroup`.

- [ ] **Step 3: Implement `auto-groups.ts`**

Create functions:

```ts
export interface AutoGroupRenderOptions {
  enabled?: boolean;
  includeAutoGroup?: boolean;
  unclassifiedPolicy?: "others" | "ignore";
}

export interface AutoGroupRenderResult {
  groups: ProxyGroupEntry[];
  unclassifiedProxyNames: string[];
}

export const renderAutoGroups = (
  proxies: ProxyNode[],
  options: AutoGroupRenderOptions = {}
): AutoGroupRenderResult => { /* classify HK/JP/US/TW/SG/KR/Others and build Proxies */ };
```

Use existing regex intent from `backend/src/lib/proxy-group.ts`, but output no emojis and make `Proxies` the top-level group.

- [ ] **Step 4: Wire draft rendering**

In `draft-operations.ts`, extend `GroupsRulesStepOperations` with `autoGroup?: AutoGroupRenderOptions`. In `applyGroupsRulesStep`, if enabled, prepend or replace generated groups before applying manual group operations.

- [ ] **Step 5: Wire template rendering**

In `render-managed-config.ts`, recognize `templatePayload.configPatch.__autoGroup` or a typed payload field if added in Task 1; call `renderAutoGroups` before group merge.

- [ ] **Step 6: Verify green**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "auto groups"`

Expected: PASS.

## Task 3: Rule Provider Attachments

**Files:**
- Create: `backend/src/lib/render/rule-provider-render.ts`
- Modify: `backend/src/modules/generated-subscription-drafts/draft-operations.ts`
- Modify: `backend/src/lib/render/render-managed-config.ts`
- Modify: `backend/src/modules/marketplace/routes.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write failing rule-provider test**

Add test `draft preview emits rule providers and RULE-SET rules`. Use seeded built-in ruleset `metacubex-geosite-openai`; save `groups_rules` operations:

```ts
{
  ruleProviderAttachments: [
    {
      type: "attach-rule-provider",
      providerSlug: "metacubex-geosite-openai",
      targetPolicy: "Proxies",
      insert: { position: "before-match" }
    }
  ],
  rules: ["MATCH,Proxies"]
}
```

Expect preview YAML to contain `rule-providers:`, `metacubex-geosite-openai:`, `/api/marketplace/rulesets/metacubex-geosite-openai/content`, and `RULE-SET,metacubex-geosite-openai,Proxies` before `MATCH,Proxies`.

- [ ] **Step 2: Verify red**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "rule providers"`

Expected: FAIL because attachments are not supported.

- [ ] **Step 3: Implement renderer**

Create `renderRuleProviderAttachments({ attachments, catalog, baseUrl })` that returns:

```ts
{
  providers: Record<string, unknown>;
  rules: string[];
  lockedReasons: string[];
}
```

Use catalog metadata for `behavior`, `updateIntervalSeconds`, and content URL. Default `baseUrl` to empty string so relative `/api/marketplace/.../content` works behind same host.

- [ ] **Step 4: Wire draft and template rendering**

Support `ruleProviderAttachments` alongside existing `ruleProviderRefs`. Insert generated `RULE-SET` according to `top`, `bottom`, or `before-match`.

- [ ] **Step 5: Verify green**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "rule providers"`

Expected: PASS.

## Task 4: Latest Snapshot And Render Failure Semantics

**Files:**
- Modify: `backend/src/modules/generated-subscription-drafts/generated-subscription-draft.service.ts`
- Modify: `backend/src/modules/subscriptions/managed-subscription.service.ts`
- Modify: `backend/src/modules/subscriptions/managed-subscription.repository.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write failing latest-snapshot test**

Add test `subscription pull replays draft against latest successful upstream snapshot`. Seed source snapshot A with `HK-01`, publish draft, seed snapshot B with `HK-02`, update source `lastSuccessfulSnapshotId` to B, deliver subscription. Expect delivered YAML contains `HK-02` and not `HK-01`.

- [ ] **Step 2: Write failing render-failure test**

Add test `render failure is persisted on subscription`. Publish a valid subscription, save an invalid group referencing `MissingProxy`, call `render`, catch error, fetch subscription detail, expect `lastRenderStatus` is `failed` and `lastErrorMessage` includes `MissingProxy`.

- [ ] **Step 3: Verify red**

Run both tests with `cd backend && bun test tests/integration.test.ts --test-name-pattern "latest successful|render failure"`

Expected: FAIL.

- [ ] **Step 4: Add explicit preview snapshot mode**

Change `GeneratedSubscriptionDraftService.preview` to accept:

```ts
interface PreviewOptions {
  preferSelectedSnapshot?: boolean;
}
```

Default to latest successful snapshot. Use selected snapshot only when `preferSelectedSnapshot` is true.

- [ ] **Step 5: Persist render failures**

Wrap `renderInternal` and `renderDraftBackedSubscription` body in failure handling that calls repository `markRenderFailure` with error message before rethrowing.

- [ ] **Step 6: Verify green**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "latest successful|render failure"`

Expected: PASS.

## Task 5: External Source Import And Sync

**Files:**
- Modify: `backend/src/modules/upstream-sources/upstream-source.service.ts`
- Modify: `backend/src/modules/generated-subscription-drafts/routes.ts`
- Modify: `backend/src/modules/generated-subscription-drafts/generated-subscription-draft.service.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write failing URL update validation test**

Add test `upstream source rejects invalid URL on update`. Create source with valid URL, call update with `notaurl`, expect `UpstreamSourceError` status 400.

- [ ] **Step 2: Write failing draft-create-with-source-url test**

Add route/service-level test for draft creation input:

```ts
{
  displayName: "Imported draft",
  sourceUrl: "http://127.0.0.1:1/unreachable"
}
```

Expect it creates an upstream source record associated with the draft, even if sync fails visibly.

- [ ] **Step 3: Verify red**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "invalid URL|source URL"`

Expected: FAIL.

- [ ] **Step 4: Implement validation and import**

Extract URL validation helper in `upstream-source.service.ts`, call it on create and update. Add `createAndSync` helper that creates then calls `sync`, returning the resulting detail. Let draft creation accept `sourceUrl` and `sourceDisplayName`.

- [ ] **Step 5: Verify green**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "invalid URL|source URL"`

Expected: PASS.

## Task 6: Temp Token Management And Sharing

**Files:**
- Modify: `backend/src/modules/subscriptions/subscription-access.repository.ts`
- Modify: `backend/src/modules/subscriptions/managed-subscription.repository.ts`
- Modify: `backend/src/modules/subscriptions/managed-subscription.service.ts`
- Modify: `backend/src/modules/subscriptions/routes.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write failing token bounds/revoke test**

Add test `temporary token enforces TTL bounds and revoke denies delivery`. Create subscription, call `createTempToken` with `60`, expect expiry near 1 hour minimum. Call with `31 * 24 * 60 * 60`, expect 30 day maximum. Revoke first token, then `deliver` with it should throw status 401.

- [ ] **Step 2: Write failing share grant test**

Add test `subscription can be shared publicly and to a user`. Create second user, call service share methods for public and target user, list grants, expect both grants.

- [ ] **Step 3: Verify red**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "temporary token|shared publicly"`

Expected: FAIL.

- [ ] **Step 4: Implement token list/revoke**

Add repository methods:

```ts
listTempTokens(userId: string, subscriptionId: string): SubscriptionTempTokenRecord[]
revokeTempToken(userId: string, subscriptionId: string, tokenId: string): boolean
```

Clamp TTL to `[3600, 30 * 24 * 60 * 60]`.

- [ ] **Step 5: Implement share grants**

Add repository/service methods to upsert public, unlisted, and user grants. For V1, target user can be resolved by email or user id.

- [ ] **Step 6: Add routes**

Add:

```text
GET /api/subscriptions/:id/temp-tokens
DELETE /api/subscriptions/:id/temp-tokens/:tokenId
GET /api/subscriptions/:id/share-grants
POST /api/subscriptions/:id/share-grants
DELETE /api/subscriptions/:id/share-grants/:grantId
```

- [ ] **Step 7: Verify green**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "temporary token|shared publicly"`

Expected: PASS.

## Task 7: Sanitized Template Extraction

**Files:**
- Create: `backend/src/lib/render/template-sanitizer.ts`
- Modify: `backend/src/modules/templates/template.repository.ts`
- Modify: `backend/src/modules/templates/template.service.ts`
- Modify: `backend/src/modules/generated-subscription-drafts/generated-subscription-draft.service.ts`
- Modify: `backend/src/modules/templates/routes.ts`
- Test: `backend/tests/integration.test.ts`

- [ ] **Step 1: Write failing sanitizer test**

Add test `sanitized template removes real proxy nodes but keeps rules and groups`. Build a draft from a source containing `HK-Secret-Node`, auto groups, and an OpenAI rule attachment. Extract sanitized template. Expect payload has no proxy named `HK-Secret-Node`, exported YAML does not contain `server`, but includes `RULE-SET` or rule attachment metadata and group names.

- [ ] **Step 2: Verify red**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "sanitized template"`

Expected: FAIL.

- [ ] **Step 3: Implement sanitizer**

Create `sanitizeTemplatePayload(payload)` that returns:

```ts
{
  payload: TemplatePayload;
  removedProxyNames: string[];
  lockedReasons: string[];
}
```

Remove `customProxies`; preserve rules, proxy group names, group types, rule provider attachments, config patch, and auto-group options. Replace group proxy lists with region/group references and reserved names only.

- [ ] **Step 4: Add service route**

Add `POST /api/templates/:id/sanitize` and draft extract option `{ sanitized: true }`.

- [ ] **Step 5: Verify green**

Run: `cd backend && bun test tests/integration.test.ts --test-name-pattern "sanitized template"`

Expected: PASS.

## Task 8: Frontend API And Product Navigation

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/providers/workspace-provider.tsx`
- Modify: `frontend/src/components/app-shell.tsx`
- Modify: `frontend/src/pages/dashboard-page.tsx`
- Test: `bun run typecheck`

- [ ] **Step 1: Update frontend types**

Mirror backend types for template shareability, token records, share grants, auto-group options, and rule-provider attachments.

- [ ] **Step 2: Add provider methods**

Add workspace methods:

```ts
listTempTokens(id)
revokeTempToken(id, tokenId)
listShareGrants(id)
upsertShareGrant(id, input)
deleteShareGrant(id, grantId)
sanitizeTemplate(id)
```

- [ ] **Step 3: Rework navigation labels**

Change nav to: 工作台, 扩展订阅, 外部订阅, 规则源, 模板, 共享, 设置. Use existing routes where practical; route labels can lead to existing pages during the first iteration.

- [ ] **Step 4: Refresh dashboard**

Dashboard should present the extended subscription workbench: stats, recent subscriptions, warnings, and a primary "新建扩展订阅" action.

- [ ] **Step 5: Verify typecheck**

Run: `bun run typecheck`

Expected: PASS.

## Task 9: Extended Subscription UI

**Files:**
- Modify: `frontend/src/pages/subscriptions-page.tsx`
- Modify: `frontend/src/pages/generated-subscription-wizard-page.tsx`
- Modify: `frontend/src/pages/templates-page.tsx`
- Modify: `frontend/src/styles.css`
- Test: `bun run typecheck`

- [ ] **Step 1: Rework subscriptions page**

Generated section becomes “扩展订阅”. Each item shows source, render/sync status, share status, key actions, and last pull/render time. Add dialogs for temp-token TTL and share target.

- [ ] **Step 2: Rework wizard source step**

Allow paste URL directly in wizard. On save, create source and sync through new backend support. Show parsing stats and errors.

- [ ] **Step 3: Add node grouping panel**

Display source nodes grouped into Proxies/HK/JP/US/TW/SG/KR/Others. Let user choose auto grouping enabled, include Auto group, and unclassified policy.

- [ ] **Step 4: Add rule attachment panel**

Ruleset selection requires target policy and insertion position. Save `ruleProviderAttachments`.

- [ ] **Step 5: Add template/share actions**

Template page shows shareability and locked reasons; add action to create sanitized template.

- [ ] **Step 6: Visual refresh**

Update `styles.css` and page classes toward a dense network console: restrained palette, stable dimensions, compact panels, clear status. Avoid card nesting and decorative orbs.

- [ ] **Step 7: Verify typecheck**

Run: `bun run typecheck`

Expected: PASS.

## Task 10: Browser Verification And Finish

**Files:**
- Modify docs if verification reveals product gaps.
- Test commands and Browser plugin.

- [ ] **Step 1: Run full automated verification**

Run:

```bash
bun run typecheck
cd backend && bun test
```

Expected: PASS for all workspaces and backend tests.

- [ ] **Step 2: Start dev servers without ports 3001 or 7001**

Run backend with a free port, for example:

```bash
PORT=3011 bun run dev:backend
```

Run frontend with API base:

```bash
VITE_API_BASE_URL=http://localhost:3011 bun run dev:frontend -- --port 5174 --strictPort
```

- [ ] **Step 3: Browser smoke test**

Use Browser plugin against `http://localhost:5174`. Verify:

- register or login works.
- dashboard loads.
- create or select external subscription.
- create extended subscription draft.
- auto grouping UI appears.
- rule source attachment appears.
- preview YAML includes `Proxies`, region groups, `rule-providers`, `RULE-SET`.
- publish succeeds.
- temp link creation and revoke UI work.
- no major desktop layout overlap.

- [ ] **Step 4: Completion audit**

Map every success criterion in the design spec to evidence: file changes, tests, browser observations, and command output. Any uncovered criterion must be fixed before reporting complete.

## Plan Self-Review

- Spec coverage: Tasks cover import/sync, latest snapshots, auto grouping, rule providers, template sanitization, sharing, key management, UI, and browser verification.
- Placeholder scan: no red-flag placeholder wording or ambiguous future-only implementation steps are intended in this plan.
- Type consistency: the same terms are used across backend and frontend: extended subscription, auto group options, rule provider attachments, temp tokens, share grants, template shareability.

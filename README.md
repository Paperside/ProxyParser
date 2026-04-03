## ProxyParser

ProxyParser is now organized as a Bun monorepo:

- `backend`: Bun + Elysia API that fetches subscriptions, patches proxy groups, and exposes status endpoints.
- `frontend`: React + TypeScript dashboard for checking subscription health and inspecting generated groups.

### Quick start

1. Install dependencies:

```bash
bun install
```

2. Add your subscription config:

- Keep your existing root `config.js`, or
- Create `backend/config.ts` from `backend/config.example.ts`

3. Start both apps together:

```bash
bun run dev
```

Production-style startup is also available:

```bash
bun run start
```

You can run either side separately with `bun run dev:backend`, `bun run dev:frontend`, `bun run start:backend`, and `bun run start:frontend`.

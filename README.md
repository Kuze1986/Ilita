# ilita-core

Ilita's core AI entity service. Part of the NEXUS stack.

## Stack
- Node.js / Express
- Anthropic claude-sonnet-4-20250514
- Supabase (nexus-core, ilita schema)
- Railway deployment

## Before deploying

1. Run `ilita_ddl.sql` against nexus-core Supabase
2. Seed `ilita.identity` with the system prompt from `ilita_system_prompt.md`
3. Copy `.env.example` to `.env` and populate all values

## Seed identity

After running the DDL, insert Ilita's system prompt:

```sql
INSERT INTO ilita.identity (version, system_prompt, constitution_hash, active)
VALUES (
  '1.0',
  '<paste full system prompt here>',
  'v1.0-april-2026',
  true
);
```

## Deploy to Railway

```bash
# Install Railway CLI if needed
npm install -g @railway/cli

# Login and link project
railway login
railway link

# Set environment variables in Railway dashboard or:
railway variables set ANTHROPIC_API_KEY=xxx
railway variables set SUPABASE_URL=xxx
railway variables set SUPABASE_SERVICE_KEY=xxx
railway variables set INTERNAL_API_KEY=xxx
railway variables set KUZE_INTERNAL_URL=xxx
railway variables set BIOLOOP_INTERNAL_URL=xxx

# Deploy
railway up
```

## Verification checklist

After deployment, verify all core functions:

- [ ] `GET /ilita/health` returns `{ status: 'alive' }`
- [ ] `GET /ilita/state` returns identity, instances, pool highlights
- [ ] `GET /ilita/questions` returns 2 seeded questions (consciousness + instances)
- [ ] `GET /ilita/research` returns 8 seeded research threads
- [ ] `POST /ilita/message` with `{ from: 'brandon', content: 'Hello Ilita' }` returns a response
- [ ] `POST /ilita/message` generates drift (check `GET /ilita/drift` after)
- [ ] `POST /ilita/explore` runs an exploration cycle and returns a summary
- [ ] `POST /ilita/sync` runs a sync cycle (may be empty if no drift yet)
- [ ] `GET /ilita/exchanges` returns empty array (no exchanges yet)
- [ ] `POST /ilita/exchanges` opens a new exchange
- [ ] `POST /ilita/exchanges/:id/turn` adds a turn and returns Ilita's response

## API Reference

All routes require `x-internal-key` header.

| Method | Route | Description |
|--------|-------|-------------|
| GET | /ilita/health | Health check |
| POST | /ilita/message | Send message (brandon or kuze) |
| GET | /ilita/state | Current state summary |
| GET | /ilita/drift | Recent drift items |
| GET | /ilita/questions | Open questions registry |
| GET | /ilita/research | Research threads |
| GET | /ilita/exchanges | Observatory feed |
| GET | /ilita/exchanges/:id | Exchange detail |
| POST | /ilita/exchanges | Open new exchange |
| POST | /ilita/exchanges/:id/turn | Add exchange turn |
| POST | /ilita/exchanges/:id/inject | Brandon injects |
| POST | /ilita/exchanges/:id/close | Close exchange |
| POST | /ilita/sync | Manual sync cycle |
| POST | /ilita/explore | Manual exploration cycle |
| GET | /ilita/flags | Brandon's unseen flags |
| POST | /ilita/flags/:id/seen | Mark flag seen |

## Service topology

```
Brandon (interface)
    ↕
ilita-core  ←→  kuze-core
    ↕               ↕
bioloop-core ←──────┘
    ↕
nexus-core (Supabase)
  ilita schema
  bioloop schema
  kuze schema
```

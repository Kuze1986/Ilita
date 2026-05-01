# Demoforge

Demoforge is a Next.js app configured for standalone production deploys.

## Local development

```bash
npm install
npm run dev
```

## Railway deployment

This repo is already configured for Railway via `railway.json`:

- Build command: `npm run build`
- Start command: `node scripts/start-standalone.cjs`
- Healthcheck path: `/api/health`

### 1) Set environment variables in Railway

Copy values from `.env.example` and set them in your Railway service.

Minimum required for app boot and auth flows:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `ADMIN_EMAIL`
- `ADMIN_CRON_SECRET`

Optional integrations:

- Stripe: `STRIPE_*`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- Redis/video workers: `REDIS_URL`, `VIDEO_*`, `DEMOFORGE_*`, `ORCHESTRATOR_WEBHOOK_URL`
- CRM: `HUBSPOT_PRIVATE_APP_TOKEN`, `SALESFORCE_INSTANCE_URL`
- Crucible simulator: `CRUCIBLE_SIM_*`

### 2) Deploy

1. Connect the repository to Railway.
2. Ensure service uses Node 22 (already set in `package.json` engines).
3. Trigger deploy.

### 3) Verify after deploy

- Health endpoint returns 200: `GET /api/health`
- App URL in `NEXT_PUBLIC_APP_URL` matches the Railway domain
- Auth callback domain is allowed in Supabase settings

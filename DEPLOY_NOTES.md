# Deploy Notes — Combined Backend Release

Release branch: `release/backend-hardening-phase1`

## 1. Pre-deploy checklist
1. Backup Railway Postgres before anything else.
2. Confirm these env vars are set in Railway:
   - `NODE_ENV=production`
   - `DATABASE_URL`, `REDIS_URL`, `BASE_URL`, `ADMIN_API_KEY`
   - `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_SECRET`
   - `BREVO_API_KEY`, `BREVO_WEBHOOK_SECRET`, `EMAIL_FROM`, `CALENDLY_LINK`
   - `APOLLO_API_KEY`, `FMCSA_API_KEY`
   - `LEO_SFTP_HOST`, `LEO_SFTP_USER`, `LEO_SFTP_PASS`
   - `PHANTOM_WEBHOOK_SECRET`, `PHANTOM_API_KEY`
   - `DEFAULT_CLIENT_ID` or `DEFAULT_CLIENT_SLUG`
   - `ALLOW_NUCLEAR_RESET=false`
   - `INSTANTLY_API_KEY`, `INSTANTLY_WEBHOOK_SECRET`, `INSTANTLY_API_BASE_URL=https://api.instantly.ai/api/v1`, `INSTANTLY_PUSH_ENABLED=false`

## 2. Prisma migration cutover
The existing production database was built with `prisma db push`, so Prisma migration history must be baselined before `migrate deploy` can run safely.

1. Confirm the branch contains:
   - `prisma/migrations/20260828000000_baseline/migration.sql`
   - `prisma/migrations/20260828000100_phase1_tenancy_instantly/migration.sql`
2. One-off against production after backup:
   ```bash
   npx prisma migrate resolve --applied 20260828000000_baseline
   ```
3. Railway start command is now:
   ```bash
   npx prisma migrate deploy && npx prisma generate && node src/server.js
   ```
4. Deploy. Expected: only `20260828000100_phase1_tenancy_instantly` applies on the existing DB; fresh DBs apply both migrations.

## 3. Webhooks to configure
- Vapi end-of-call: `POST /webhook/vapi/done` with `x-vapi-secret` or Bearer secret.
- Phantom Buster: `POST /webhook/phantom?secret=...` or `x-phantom-secret`.
- Brevo inbound SMS/STOP: `POST /webhook/brevo/inbound` with Brevo secret.
- Instantly agency-client acquisition: `POST /webhook/instantly` with `x-instantly-secret`, Bearer secret, or `?secret=...`.

Production behavior: missing webhook secrets fail closed.

## 4. Phase 1 manual client test
Create 2–3 clients:

```bash
curl -X POST "$BASE_URL/admin/clients" \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Client One Insurance",
    "slug": "client-one",
    "licensedStates": ["MI", "TN"],
    "calendlyLink": "https://calendly.com/client-one",
    "brevoSenderName": "Client One",
    "brevoSenderEmail": "agent@clientone.com"
  }'
```

Then either:
- set `DEFAULT_CLIENT_ID` to the legacy agency client for existing flow, or
- pass `clientId` when creating leads via `POST /api/leads`.

All lead creation and lead listing now require `x-admin-key`.

## 5. Safety changes in this release
- No `prisma db push --accept-data-loss` on deploy.
- Header-only admin key.
- Fail-closed production webhooks.
- Dial-time DNC recheck before every Vapi call.
- Consent artifact before qualified SMS/email.
- Brevo STOP inbound handling.
- Bull `jobId: call:<leadId>` dedupe on call jobs.
- Nuclear reset disabled unless `ALLOW_NUCLEAR_RESET=true` and body includes `confirm: RESET_ALL_DATA`.

## 6. Rollback
- Revert Railway to the previous deployment.
- If migration cutover failed, restore the DB backup.
- Keep `ALLOW_NUCLEAR_RESET=false` in production.

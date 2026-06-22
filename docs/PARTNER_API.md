# Partner API (Silo)

Merchant-scoped read API served by the existing FEB backend at `/partner/v1`.

## Authentication

Every request requires:

- `x-api-key`: public credential id (e.g. `febk_live_...`)
- `x-api-secret`: secret shown once at issuance
- Browser requests must include an `Origin` (or `Referer`) host on the credential's `allowedDomains`

Alternative: `Authorization: Basic base64(key:secret)`

## Endpoints

| Method | Path | Scope | Description |
|--------|------|-------|-------------|
| GET | `/partner/v1/merchant` | `merchant:read` | Public merchant profile (name, org, logo, website, contact) |
| GET | `/partner/v1/theme` | `merchant:read` | Silo storefront theme (preset, brand colors, fonts) |
| GET | `/partner/v1/legal` | `merchant:read` | Privacy policy and terms HTML for silo legal pages |
| GET | `/partner/v1/events` | `events:read` | Merchant events (active + inactive past; inactive upcoming hidden) |
| GET | `/partner/v1/events/:id` | `events:read` | Single event (404 if not owned, or inactive and not yet past). Supports `?presale=TOKEN` → `presaleAccess: true` when valid |
| POST | `/partner/v1/events/:id/waitlist/send-code` | `waitlist:write` | Send 8-digit OTP for waitlist join (requires merchant silo SMTP configured) |
| POST | `/partner/v1/events/:id/waitlist` | `waitlist:write` | Join waitlist with email + OTP; publishes `waitlist.join` to EMS |

### Query params (`/events`)

- `page` (default 1)
- `limit` (default 50, max 200)
- `city`
- `country`

### Query params (`/events/:id`)

- `presale` — optional one-time presale token; when valid, response includes `presaleAccess: true`

### Waitlist join bodies

`POST .../waitlist/send-code`:

```json
{ "email": "fan@example.com", "locale": "en-US" }
```

`POST .../waitlist`:

```json
{ "email": "fan@example.com", "code": "12345678", "locale": "en-US" }
```

Waitlist emails use **merchant SMTP** from `silo_settings.email` (configured in EMF), not Okazzo platform templates. Returns `503` with `SILO_EMAIL_NOT_CONFIGURED` when SMTP is incomplete.

**SMTP password crypto:** EMS encrypts `silo_settings.email.smtp.password` at rest; FEB decrypts when sending. Both services must share the same `SILO_SMTP_CRYPTO_KEY` (falls back to each service's `CRYPTO_KEY` only if unset — EMS and FEB typically use different `CRYPTO_KEY` values, so set `SILO_SMTP_CRYPTO_KEY` explicitly on both).

Event objects may include `waitlistConfig`, `pre_sale_waitlist_count`, and `pre_sale_waitlist_cap` for silo UI.

## Admin credential management (superadmin)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/merchant/:id/api-credentials` | Issue credential (returns secret once) |
| GET | `/api/merchant/:id/api-credentials` | List credentials (no secrets) |
| POST | `/api/merchant/:id/api-credentials/:keyId/rotate` | Rotate secret |
| PATCH | `/api/merchant/:id/api-credentials/:keyId` | Update domains/scopes/status |
| DELETE | `/api/merchant/:id/api-credentials/:keyId` | Revoke credential |

### Issue body example

```json
{
  "allowedDomains": ["events.merchant.com", "www.events.merchant.com"],
  "scopes": ["events:read", "merchant:read", "waitlist:write"],
  "label": "production",
  "serverToServer": true
}
```

Set `serverToServer: true` when the silo storefront BFF calls the partner API from Next.js server-side route handlers (no browser `Origin`). Keep `allowedDomains` for direct browser access protection.

## Error model

| Status | error | Meaning |
|--------|-------|---------|
| 401 | `MISSING_API_CREDENTIALS` | Headers missing |
| 401 | `INVALID_API_CREDENTIALS` | Bad key/secret |
| 403 | `DOMAIN_NOT_ALLOWED` | Origin not on allowlist |
| 403 | `SILO_NOT_ENABLED` | No active partner API credentials (storefront deprovisioned in CMS) |
| 403 | `INSUFFICIENT_SCOPE` | Missing required scope |
| 404 | `RESOURCE_NOT_FOUND` | Event not found or not owned |
| 429 | `RATE_LIMIT_EXCEEDED` | Per-key rate limit |

## Silo frontend integration

Never expose `x-api-secret` in the browser. Use a server-side BFF (Next.js route handlers) that attaches credentials and calls the partner API.

Theme settings are configured in the merchant backoffice (EMS `orginfo.silo_settings`), synced to MongoDB via `merchant.updated`, and served at `GET /partner/v1/theme` for the silo BFF.

**Two controls (platform admin only):**

1. **FEB-CMS** — Issue/revoke partner API credentials. First active credential sets `siloSettings.enabled: true`; revoking the last active credential sets `enabled: false` and notifies EMS via `MerchantSiloToggled`.
2. **EMF** — Merchants configure theme, domain, legal, SMTP, and gallery only. They cannot toggle `enabled`; EMF shows read-only provision status synced from CMS.

### Hosting ownership (Option A)

- Silo hosting is **platform-managed per merchant** (dedicated S3 + CloudFront).
- Issuing first active credential emits a deployment request (`MerchantSiloDeploymentRequested`, `action=provision`).
- Revoking the last active credential emits `action=deprovision`.
- FEB backend consumes deployment requests asynchronously and updates deployment status (`provisioning`, `provisioned`, `deprovisioning`, `deprovisioned`, `*_failed`) in `siloSettings.deployment`.
- Deployment status is broadcast to EMS via `MerchantSiloDeploymentStatusChanged` so EMF can display read-only hosting state.
- EMF must not collect CloudFront/S3 identifiers from merchants.

Required env for per-merchant hosting automation:

- `SILO_DEPLOYMENT_BUCKET_PREFIX` (default: `okazzo-silo`)
- `SILO_DEPLOYMENT_AWS_REGION` (fallback: `AWS_REGION` / `BUCKET_REGION`, default `eu-central-1`)
- `SILO_DEPLOYMENT_CLOUDFRONT_PRICE_CLASS` (default: `PriceClass_100`)
- AWS credentials: prefers standard (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`) and falls back to existing project vars (`BUCKET_ACCESS_CLIENT`, `BUCKET_ACCESS_KEY`, optional `BUCKET_SESSION_TOKEN`)

### Merchant profile fields (`/merchant`)

Public contact fields resolve from company details first, then personal fallbacks:

- `email` — `companyEmail` or `email`
- `phone` — `companyPhoneNumber` or `phone`
- `address` — `companyAddress` or `address`
- `website`, `logo`, `orgName`, `country`, `status`
- `socialMedia` — `{ facebook, instagram, tiktok, twitter, linkedin }` profile URLs

### Legal pages (`/legal`)

Returns HTML for silo storefront `/privacy` and `/terms` pages:

```json
{
  "legal": {
    "privacy": { "source": "platform", "html": "<h2>Introduction</h2>..." },
    "terms": { "source": "merchant", "html": "<p>Custom terms</p>" }
  }
}
```

- `source: "merchant"` — custom HTML saved in EMS `orginfo.silo_settings.legal`
- `source: "platform"` — Finnep default legal from platform `Setting.otherInfo` (used when merchant HTML is empty)

Configure custom legal HTML in the merchant backoffice under **Silo Storefront → Legal pages**.

## Pilot onboarding checklist

1. Merchant activated in EMS/FEB
2. Superadmin issues API credential with merchant domain(s)
3. Merchant deploys silo storefront with server-side env vars
4. Verify CORS preflight from merchant domain
5. Verify cross-merchant isolation (credential A cannot read merchant B events)

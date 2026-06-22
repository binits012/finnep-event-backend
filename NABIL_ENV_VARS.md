# Nabil EPG Environment Variables

Configure after obtaining credentials from Nabil Bank Merchant Services (EPG agreement).

```bash
# Required for production Nabil payments
NABIL_EPG_MERCHANT_ID=
NABIL_EPG_SECRET_KEY=
NABIL_EPG_API_URL=              # Base URL from Nabil IT (sandbox + production)

# Redirect / webhook URLs (HTTPS in production)
NABIL_CALLBACK_SUCCESS_URL=     # e.g. https://yourdomain.com/front/webhooks/nabil/success
NABIL_CALLBACK_CANCEL_URL=      # e.g. https://yourdomain.com/payment/cancel
NABIL_WEBHOOK_URL=              # Server-to-server confirmation URL

# Optional
NABIL_PLATFORM_COMMISSION=3       # Reporting only (v1 manual settlement)
NABIL_SANDBOX_MODE=false          # true = skip live API (local dev only)
NABIL_ALLOW_LOCALHOST=true        # Dev: allow localhost callback URLs
```

## Notes

- NPR amounts are sent in **paisa** (1 NPR = 100 paisa) unless Nabil docs specify otherwise — confirm in Phase 0 sandbox.
- PCI: use **hosted redirect only**; never embed card fields in the frontend.
- Platform holds a single EPG merchant account; sub-merchants are tracked via order reference stamp (`M{merchantId}-E{eventId}-...`).

## Phase 4 (optional, not in v1)

- **Khalti / eSewa**: domestic wallet rails for Nepal — add as second `paymentProvider` after Nabil EPG is stable.
- **Coupons + seated events**: enable for dual-payment merchants once dual-currency coupon logic and seat pricing are designed (currently blocked in EMS + FEB v1 guards).

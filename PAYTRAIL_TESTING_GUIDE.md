# Paytrail Integration Testing Guide

## Environment Setup

1. Add environment variables to `.env` (see `PAYTRAIL_ENV_VARS.md`)

2. Default mode: **Single Account Mode** (no subscription fee)
   - `PAYTRAIL_SHOP_IN_SHOP_ENABLED=false` (default)
   - All merchants use platform Paytrail account
   - Payments tracked via stamp encoding

## Testing Single Account Mode (Default)

### 1. Enable Paytrail for a Merchant (CMS)

1. Go to CMS → Merchants
2. Click "View Details" on a merchant
3. In the modal, find "Paytrail Payment Gateway" section
4. Toggle "Enable Paytrail for this merchant" ON
5. Set commission rate (default: 3%)
6. Click "Update Commission Rate" if changed

### 2. Test Frontend Checkout

1. Navigate to an event from the enabled merchant
2. Select tickets and proceed to checkout
3. You should see payment method selection:
   - **Credit/Debit Card** (Stripe)
   - **Finnish Banks** (Paytrail) - only if merchant has Paytrail enabled
4. Select Paytrail option
5. Click "Continue to Paytrail"
6. You should be redirected to Paytrail payment page

### 3. Test Payment Flow

1. Complete payment on Paytrail page
2. You should be redirected back to success page
3. Ticket should be created automatically via webhook
4. Check ticket in CMS to verify Paytrail transaction ID

## Testing Shop-in-Shop Mode (Optional)

### 1. Enable Shop-in-Shop Mode

**Option A: Via Environment Variable**
```bash
PAYTRAIL_SHOP_IN_SHOP_ENABLED=true
```

**Option B: Via Admin API**
```bash
POST /api/admin/paytrail/shop-in-shop/toggle
{
  "enabled": true
}
```

### 2. Create Sub-Merchant Account

1. Go to CMS → Merchants
2. Click "View Details" on a merchant
3. In Paytrail section, you should see option to create sub-merchant
4. Enter IBAN and BIC
5. Set commission rate
6. Create sub-merchant account

### 3. Enable Paytrail for Merchant

1. Toggle "Enable Paytrail for this merchant" ON
2. Merchant can now accept Paytrail payments with automatic settlement

## API Endpoints

### Admin Endpoints (Require Authentication)

- `POST /api/admin/paytrail/toggle` - Enable/disable Paytrail for merchant
- `POST /api/admin/paytrail/create-submerchant` - Create sub-merchant (shop-in-shop only)
- `POST /api/admin/paytrail/shop-in-shop/toggle` - Toggle shop-in-shop mode

### Public Endpoints

- `POST /front/create-paytrail-payment` - Create Paytrail payment
- `POST /front/webhooks/paytrail/success` - Webhook for successful payment
- `POST /front/webhooks/paytrail/cancel` - Webhook for cancelled payment

## Verification Checklist

- [ ] Environment variables set in `.env`
- [ ] Merchant has Paytrail enabled in CMS
- [ ] Frontend shows Paytrail payment option
- [ ] Payment redirects to Paytrail
- [ ] Webhook creates ticket after payment
- [ ] Ticket has `paymentProvider: 'paytrail'`
- [ ] Ticket has `paytrailTransactionId`
- [ ] Commission rate is correct

## Troubleshooting

### Paytrail option not showing in checkout
- Check merchant has `paytrailEnabled: true` in database
- Verify event API returns `merchant.paytrailEnabled` in response
- Check browser console for errors

### Payment creation fails
- Verify `PAYTRAIL_MERCHANT_ID` and `PAYTRAIL_SECRET_KEY` are correct
- Check API logs for HMAC signature errors
- Verify webhook URL is accessible

### Webhook not creating tickets
- Check webhook URL is correct in Paytrail dashboard
- Verify signature verification is working
- Check Redis for payment data (key: `paytrail_payment:{stamp}`)

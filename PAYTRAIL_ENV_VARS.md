# Paytrail Environment Variables

Add these environment variables to your `.env` file:

```bash
# Paytrail Configuration (Aggregate/Platform Merchant Account)
# This is your main Paytrail account that acts as:
# - Platform account in single account mode (all payments go here)
# - Aggregate merchant in shop-in-shop mode (owns all sub-merchants)
PAYTRAIL_MERCHANT_ID=your_merchant_id
PAYTRAIL_SECRET_KEY=your_secret_key
PAYTRAIL_API_URL=https://services.paytrail.com
PAYTRAIL_CALLBACK_SUCCESS_URL=https://okazzo.eu/checkout
PAYTRAIL_CALLBACK_CANCEL_URL=https://okazzo.eu/payment/cancel
PAYTRAIL_WEBHOOK_URL=https://api.okazzo.eu/api/webhooks/paytrail

# For local development only: Allow localhost URLs (will show warnings)
# Set to 'true' to allow localhost URLs in development mode
# Note: Paytrail will still reject localhost URLs, so use ngrok or similar for testing
PAYTRAIL_ALLOW_LOCALHOST=false

# Paytrail Shop-in-Shop Toggle (default: false = single account mode)
# When false: All merchants use platform Paytrail account (no subscription fee)
# When true: Shop-in-shop mode enabled (requires subscription, automatic settlement)
PAYTRAIL_SHOP_IN_SHOP_ENABLED=false

# Default platform commission rate (can be overridden per merchant in CMS)
PAYTRAIL_PLATFORM_COMMISSION=3
```

## How Aggregate Merchant ID Works

### Single Account Mode (Default)
- **PAYTRAIL_MERCHANT_ID** = Platform merchant account
- All payments go directly to this account
- Merchants tracked via stamp encoding: `M{merchantId}-E{eventId}-T{ticketId}-{timestamp}`
- Manual payouts to merchants required

### Shop-in-Shop Mode (When Enabled)
- **PAYTRAIL_MERCHANT_ID** = Aggregate merchant account (platform account)
- **checkout-account header** = Uses aggregate merchant ID (for API authentication)
- **items[].merchant** = Sub-merchant ID (for automatic settlement)
- Payments automatically split:
  - Sub-merchant receives: `(100 - commissionRate)%`
  - Platform receives: `commissionRate%`
- Automatic settlement to sub-merchant bank accounts

## Important URL Requirements

⚠️ **Paytrail requires all callback and redirect URLs to:**
- Use **HTTPS** (not HTTP)
- Use **domain names** (not IP addresses)
- Be publicly accessible

**Examples:**
- ✅ `https://okazzo.eu/payment/success`
- ✅ `https://api.okazzo.eu/api/webhooks/paytrail`
- ❌ `http://okazzo.eu/payment/success` (HTTP not allowed in production)
- ❌ `https://192.168.1.1/payment/success` (IP address not allowed)
- ❌ `https://localhost:3000/payment/success` (localhost not allowed - Paytrail will reject it)

**For Local Development:**
- The validation will allow localhost URLs in development mode (with warnings)
- However, **Paytrail will still reject localhost URLs** when creating payments
- **Solution**: Use a tool like [ngrok](https://ngrok.com/) to create HTTPS tunnels:
  ```bash
  # Install ngrok, then run:
  ngrok http 3000

  # Use the HTTPS URL provided by ngrok:
  PAYTRAIL_CALLBACK_SUCCESS_URL=https://abc123.ngrok.io/checkout
  PAYTRAIL_CALLBACK_CANCEL_URL=https://abc123.ngrok.io/payment/cancel
  PAYTRAIL_WEBHOOK_URL=https://abc123.ngrok.io/api/webhooks/paytrail
  ```

## Notes

- **PAYTRAIL_MERCHANT_ID**: This is your **aggregate/platform merchant account**. It's used in both modes:
  - Single account: All payments go here
  - Shop-in-shop: Used for API authentication, owns all sub-merchants
- **PAYTRAIL_SHOP_IN_SHOP_ENABLED**: Default is `false` (single account mode). Can be overridden via CMS admin panel.
- **PAYTRAIL_PLATFORM_COMMISSION**: Default commission rate in percentage (e.g., `3` = 3%). Can be configured per merchant in CMS.
- In shop-in-shop mode, each merchant needs a sub-merchant account created via CMS before they can accept Paytrail payments.

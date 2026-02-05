# Paytrail Architecture: Aggregate Merchant ID Usage

## Overview

The **PAYTRAIL_MERCHANT_ID** (aggregate/platform merchant ID) is the core account that controls all Paytrail operations. How it's used depends on the mode:

## Single Account Mode (Default)

```
┌─────────────────────────────────────────┐
│  PAYTRAIL_MERCHANT_ID (Platform)       │
│  - All payments go here                │
│  - Merchant tracked via stamp           │
│  - Manual payouts required              │
└─────────────────────────────────────────┘
         ▲
         │ All payments
         │
    ┌────┴────┐
    │Merchant1│  Stamp: M{merchant1}-E{event}-T{ticket}-{time}
    │Merchant2│  Stamp: M{merchant2}-E{event}-T{ticket}-{time}
    │Merchant3│  Stamp: M{merchant3}-E{event}-T{ticket}-{time}
    └─────────┘
```

**API Request Structure:**
```javascript
Headers: {
  'checkout-account': PAYTRAIL_MERCHANT_ID  // Platform account
}
Body: {
  items: [
    {
      // No merchant field - all go to platform account
      unitPrice: 10000,
      units: 1
    }
  ]
}
```

## Shop-in-Shop Mode (When Enabled)

```
┌─────────────────────────────────────────┐
│  PAYTRAIL_MERCHANT_ID (Aggregate)      │
│  - Owns all sub-merchants              │
│  - Used for API authentication         │
│  - Receives platform commission        │
└─────────────────────────────────────────┘
         │
         │ API calls authenticated with aggregate ID
         │
    ┌────┴────────────────────────────┐
    │                                │
    ▼                                ▼
┌──────────┐                    ┌──────────┐
│Sub-Merch1│                    │Sub-Merch2│
│(ID: 123) │                    │(ID: 456) │
│          │                    │          │
│Auto-settl│                    │Auto-settl│
│to bank   │                    │to bank   │
└──────────┘                    └──────────┘
```

**API Request Structure:**
```javascript
Headers: {
  'checkout-account': PAYTRAIL_MERCHANT_ID  // Aggregate merchant (for auth)
}
Body: {
  items: [
    {
      merchant: subMerchantId,  // Sub-merchant ID (for settlement)
      unitPrice: 10000,
      units: 1,
      commission: {
        merchant: subMerchantId,  // Sub-merchant receives 97%
        amount: 9700
      }
      // Platform automatically receives 3% (10000 - 9700)
    }
  ]
}
```

## Key Points

1. **Aggregate Merchant ID is Always Used in Headers**
   - Both modes use `PAYTRAIL_MERCHANT_ID` in `checkout-account` header
   - This authenticates the API request

2. **Single Account Mode**
   - No sub-merchant IDs needed
   - All payments go to platform account
   - Merchant identification via stamp encoding

3. **Shop-in-Shop Mode**
   - Aggregate merchant ID in headers (authentication)
   - Sub-merchant ID in payment body items (settlement)
   - Automatic commission split and settlement

4. **System Flow**
   ```
   Payment Request
   ↓
   Check: isShopInShopEnabled()?
   ↓
   ├─ NO → createSingleAccountPayment()
   │        (uses aggregate ID, no sub-merchant)
   │
   └─ YES → createShopInShopPayment()
            (uses aggregate ID in header, sub-merchant in body)
   ```

## Environment Variable Setup

The aggregate merchant ID is set once in `.env`:
```bash
PAYTRAIL_MERCHANT_ID=375917  # Your aggregate/platform merchant ID
PAYTRAIL_SECRET_KEY=your_secret_key  # Secret for aggregate account
```

This same account is used in both modes - the difference is:
- **Single account**: Direct payments to this account
- **Shop-in-shop**: This account owns/manages sub-merchants

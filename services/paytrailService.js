import crypto from 'crypto';
import fetch from 'node-fetch';

class PaytrailShopInShopService {
    constructor() {
        // Aggregate/Platform Merchant ID - This is the main Paytrail account
        // In shop-in-shop mode: This is the aggregate merchant that owns all sub-merchants
        // In single account mode: This is the platform account used by all merchants
        this.merchantId = process.env.PAYTRAIL_MERCHANT_ID;

        // Secret key for the aggregate/platform merchant account
        this.secretKey = process.env.PAYTRAIL_SECRET_KEY;
        this.apiUrl = process.env.PAYTRAIL_API_URL || 'https://services.paytrail.com';
        this.platformCommission = parseFloat(process.env.PAYTRAIL_PLATFORM_COMMISSION || '3');

        // Validate Paytrail URLs - must be HTTPS and not IP addresses
        this.validatePaytrailUrls();
    }

    validatePaytrailUrls() {
        const urls = {
            'PAYTRAIL_CALLBACK_SUCCESS_URL': process.env.PAYTRAIL_CALLBACK_SUCCESS_URL,
            'PAYTRAIL_CALLBACK_CANCEL_URL': process.env.PAYTRAIL_CALLBACK_CANCEL_URL,
            'PAYTRAIL_WEBHOOK_URL': process.env.PAYTRAIL_WEBHOOK_URL
        };

        // Check if we're in development mode
        const isDevelopment = process.env.NODE_ENV !== 'production';
        const allowLocalhost = process.env.PAYTRAIL_ALLOW_LOCALHOST === 'true' || isDevelopment;

        // Regex to match IP addresses (IPv4)
        const ipRegex = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?/;
        const httpRegex = /^http:\/\//;
        const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1)/;

        for (const [envVar, url] of Object.entries(urls)) {
            if (!url) {
                throw new Error(`${envVar} is required. Please set it in your .env file.`);
            }

            // In development, allow localhost but warn
            if (allowLocalhost && localhostRegex.test(url)) {
                console.warn(`⚠️  WARNING: ${envVar} uses localhost (${url}). This will NOT work with Paytrail in production.`);
                console.warn(`   For local development, consider using ngrok or a similar tool to create HTTPS URLs.`);
                continue; // Skip further validation for localhost in dev mode
            }

            // Check if URL uses HTTP instead of HTTPS (strict in production)
            if (httpRegex.test(url)) {
                throw new Error(`${envVar} must use HTTPS, not HTTP. Current value: ${url}\nPlease update it to use https://`);
            }

            // Check if URL is an IP address
            if (ipRegex.test(url)) {
                throw new Error(`${envVar} cannot be an IP address. Paytrail requires domain names with HTTPS.\nCurrent value: ${url}\nPlease use a domain name like: https://yourdomain.com/path`);
            }

            // Check if URL starts with https://
            if (!url.startsWith('https://')) {
                throw new Error(`${envVar} must start with https://. Current value: ${url}`);
            }
        }
    }

    // Generate HMAC signature for API requests
    calculateHmac(params, body = '') {
        const hmacPayload = Object.keys(params)
            .sort()
            .map(key => `${key}:${params[key]}`)
            .join('\n');

        const hmacData = body ? `${hmacPayload}\n${body}` : hmacPayload;

        return crypto
            .createHmac('sha512', this.secretKey)
            .update(hmacData)
            .digest('hex');
    }

    // Generate unique stamp (reference) with merchant+event encoding
    generateStamp(merchantId, eventId, ticketId) {
        const timestamp = Date.now();
        return `M${merchantId}-E${eventId}-T${ticketId}-${timestamp}`;
    }

    // Check if shop-in-shop mode is enabled
    async isShopInShopEnabled() {
        // Check database setting first (override)
        const Setting = await import('../model/setting.js');
        const settings = await Setting.getSetting();

        if (settings && settings.length > 0) {
            const latestSetting = settings[settings.length - 1];
            if (latestSetting.otherInfo) {
                // Handle both Map and plain object cases
                // Mongoose may return Map as plain object when retrieved from DB
                let shopInShopEnabled;
                if (typeof latestSetting.otherInfo.get === 'function') {
                    // It's a Map
                    shopInShopEnabled = latestSetting.otherInfo.get('paytrailShopInShopEnabled');
                } else {
                    // It's a plain object
                    shopInShopEnabled = latestSetting.otherInfo.paytrailShopInShopEnabled;
                }

                if (shopInShopEnabled !== undefined) {
                    return shopInShopEnabled === true;
                }
            }
        }

        // Fall back to environment variable (default: false)
        return process.env.PAYTRAIL_SHOP_IN_SHOP_ENABLED === 'true';
    }

    // Create single account payment (platform account for all merchants)
    async createSingleAccountPayment(paymentData) {
        const {
            amount,
            currency = 'EUR',
            merchantId,
            eventId,
            ticketId,
            email,
            items,
            customer,
            commissionRate // Platform commission rate (for tracking only)
        } = paymentData;

        const stamp = this.generateStamp(merchantId, eventId, ticketId);
        const reference = crypto.randomBytes(8).toString('hex');

        // Calculate commission (for tracking, not automatic split)
        const commission = Math.round(amount * (commissionRate / 100));

        // In single account mode:
        // - checkout-account header = Platform Merchant ID (all payments go here)
        // - No sub-merchant fields in items (merchant tracked via stamp encoding)
        // - Commission calculated for tracking only (manual payouts)
        const headers = {
            'checkout-account': this.merchantId, // Platform merchant ID (aggregate account)
            'checkout-algorithm': 'sha512',
            'checkout-method': 'POST',
            'checkout-nonce': crypto.randomUUID(),
            'checkout-timestamp': new Date().toISOString()
        };

        const body = {
            stamp: stamp, // Stamp encodes merchant ID: M{merchantId}-E{eventId}-T{ticketId}-{timestamp}
            reference: reference,
            amount: amount, // Total amount in cents
            currency: currency,
            language: 'FI',
            items: items, // No sub-merchant or commission fields (single account mode)
            customer: customer,
            redirectUrls: {
                success: `${process.env.PAYTRAIL_CALLBACK_SUCCESS_URL}?payment=paytrail&stamp=${stamp}`,
                cancel: `${process.env.PAYTRAIL_CALLBACK_CANCEL_URL}?payment=paytrail&stamp=${stamp}`
            },
            callbackUrls: {
                success: `${process.env.PAYTRAIL_WEBHOOK_URL}/success`,
                cancel: `${process.env.PAYTRAIL_WEBHOOK_URL}/cancel`
            }
        };

        const bodyString = JSON.stringify(body);
        headers['signature'] = this.calculateHmac(headers, bodyString);

        const response = await fetch(`${this.apiUrl}/payments`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: bodyString
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Paytrail API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();

        // Return with commission details and stamp (Paytrail API doesn't return stamp, so we include it)
        return {
            ...result,
            stamp: stamp, // Include the stamp we generated
            commission: {
                platformAmount: commission,
                merchantAmount: amount - commission,
                rate: commissionRate
            }
        };
    }

    // Create shop-in-shop payment with commission handling
    async createShopInShopPayment(paymentData) {
        const {
            amount,
            currency = 'EUR',
            merchantId,
            eventId,
            ticketId,
            email,
            items,
            customer,
            subMerchantId, // Shop-in-shop sub-merchant ID
            commissionRate // Platform commission rate (default 3%)
        } = paymentData;

        if (!subMerchantId) {
            throw new Error('Sub-merchant ID required for shop-in-shop payment');
        }

        const stamp = this.generateStamp(merchantId, eventId, ticketId);
        const reference = crypto.randomBytes(8).toString('hex');

        // Calculate commission
        const commission = Math.round(amount * (commissionRate / 100));
        const subMerchantAmount = amount - commission;

        // In shop-in-shop mode:
        // - checkout-account header = Aggregate/Platform Merchant ID (for API authentication)
        // - items[].merchant = Sub-merchant ID (for automatic settlement to sub-merchant)
        // - commission.merchant = Sub-merchant ID (platform commission is auto-deducted)
        const headers = {
            'checkout-account': this.merchantId, // Aggregate merchant ID (platform account)
            'checkout-algorithm': 'sha512',
            'checkout-method': 'POST',
            'checkout-nonce': crypto.randomUUID(),
            'checkout-timestamp': new Date().toISOString()
        };

        const body = {
            stamp: stamp,
            reference: reference,
            amount: amount, // Total amount in cents
            currency: currency,
            language: 'FI',
            items: items.map(item => ({
                ...item,
                // Sub-merchant ID - Payment will be settled to this sub-merchant
                merchant: subMerchantId,
                // Commission structure - Platform commission auto-deducted, rest to sub-merchant
                commission: {
                    merchant: subMerchantId, // Sub-merchant receives (100 - commissionRate)%
                    amount: Math.round(item.unitPrice * item.units * (1 - commissionRate / 100))
                }
            })),
            customer: customer,
            redirectUrls: {
                success: `${process.env.PAYTRAIL_CALLBACK_SUCCESS_URL}?payment=paytrail&stamp=${stamp}`,
                cancel: `${process.env.PAYTRAIL_CALLBACK_CANCEL_URL}?payment=paytrail&stamp=${stamp}`
            },
            callbackUrls: {
                success: `${process.env.PAYTRAIL_WEBHOOK_URL}/success`,
                cancel: `${process.env.PAYTRAIL_WEBHOOK_URL}/cancel`
            }
        };

        const bodyString = JSON.stringify(body);
        headers['signature'] = this.calculateHmac(headers, bodyString);

        const response = await fetch(`${this.apiUrl}/payments`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: bodyString
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Paytrail API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();

        // Return with commission details and stamp (Paytrail API doesn't return stamp, so we include it)
        return {
            ...result,
            stamp: stamp, // Include the stamp we generated
            commission: {
                platformAmount: commission,
                subMerchantAmount: subMerchantAmount,
                rate: commissionRate
            }
        };
    }

    // Create sub-merchant account (Admin only)
    async createSubMerchant(subMerchantData) {
        const {
            merchantName,
            businessId,
            iban,
            bic,
            email,
            phone,
            address
        } = subMerchantData;

        // Note: Actual API endpoint and payload structure should be verified with Paytrail docs
        // This is a conceptual implementation based on shop-in-shop patterns
        const headers = {
            'checkout-account': this.merchantId,
            'checkout-algorithm': 'sha512',
            'checkout-method': 'POST',
            'checkout-nonce': crypto.randomUUID(),
            'checkout-timestamp': new Date().toISOString()
        };

        const body = {
            name: merchantName,
            businessId: businessId,
            iban: iban,
            bic: bic,
            email: email,
            phone: phone,
            address: address
        };

        const bodyString = JSON.stringify(body);
        headers['signature'] = this.calculateHmac(headers, bodyString);

        const response = await fetch(`${this.apiUrl}/merchants/submerchants`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: bodyString
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create sub-merchant: ${response.status} - ${errorText}`);
        }

        return await response.json();
    }

    // Get sub-merchant details
    async getSubMerchant(subMerchantId) {
        const headers = {
            'checkout-account': this.merchantId,
            'checkout-algorithm': 'sha512',
            'checkout-method': 'GET',
            'checkout-nonce': crypto.randomUUID(),
            'checkout-timestamp': new Date().toISOString()
        };

        headers['signature'] = this.calculateHmac(headers);

        const response = await fetch(`${this.apiUrl}/merchants/submerchants/${subMerchantId}`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`Failed to get sub-merchant: ${response.status}`);
        }

        return await response.json();
    }

    // Verify webhook signature
    verifyWebhookSignature(params, signature) {
        const calculatedSignature = this.calculateHmac(params);
        return calculatedSignature === signature;
    }

    // Get payment by transaction ID
    async getPayment(transactionId) {
        const headers = {
            'checkout-account': this.merchantId,
            'checkout-algorithm': 'sha512',
            'checkout-method': 'GET',
            'checkout-transaction-id': transactionId,
            'checkout-nonce': crypto.randomUUID(),
            'checkout-timestamp': new Date().toISOString()
        };

        headers['signature'] = this.calculateHmac(headers);

        const response = await fetch(`${this.apiUrl}/payments/${transactionId}`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`Paytrail API error: ${response.status}`);
        }

        return await response.json();
    }
}

export default new PaytrailShopInShopService();

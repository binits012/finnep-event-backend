import crypto from 'crypto';
import fetch from 'node-fetch';

/**
 * Nabil EPG payment service (hosted redirect, platform account).
 * API shape is configurable via env until Nabil IT provides final sandbox docs.
 */
class NabilPaymentService {
  constructor() {
    this.merchantId = process.env.NABIL_EPG_MERCHANT_ID;
    this.secretKey = process.env.NABIL_EPG_SECRET_KEY;
    this.apiUrl = (process.env.NABIL_EPG_API_URL || '').replace(/\/$/, '');
    this.sandboxMode = process.env.NABIL_SANDBOX_MODE === 'true';
    this.platformCommission = parseFloat(process.env.NABIL_PLATFORM_COMMISSION || '3');
  }

  isConfigured() {
    return Boolean(this.merchantId && this.secretKey && this.apiUrl) || this.sandboxMode;
  }

  generateStamp(merchantId, eventId, ticketId) {
    const timestamp = Date.now();
    return `M${merchantId}-E${eventId}-T${ticketId}-${timestamp}`;
  }

  /**
   * HMAC-SHA512 over sorted key:value lines + optional body (mirrors Paytrail-style signing).
   */
  calculateHmac(params, body = '') {
    const hmacPayload = Object.keys(params)
      .sort()
      .map((key) => `${key}:${params[key]}`)
      .join('\n');
    const hmacData = body ? `${hmacPayload}\n${body}` : hmacPayload;
    return crypto.createHmac('sha512', this.secretKey || 'sandbox').update(hmacData).digest('hex');
  }

  verifyWebhookSignature(params, signature) {
    if (!signature) return false;
    const expected = this.calculateHmac(params, '');
    try {
      const sigBuf = Buffer.from(String(signature));
      const expBuf = Buffer.from(String(expected));
      if (sigBuf.length !== expBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  /**
   * @param {object} paymentData
   * @returns {Promise<{ href: string, stamp: string, transactionId: string, commission?: object }>}
   */
  async createPayment(paymentData) {
    const {
      amount,
      currency = 'NPR',
      merchantId,
      eventId,
      ticketId,
      customer,
      redirectSuccessUrl,
      redirectCancelUrl
    } = paymentData;

    const stamp = this.generateStamp(merchantId, eventId, ticketId);
    const transactionId = crypto.randomBytes(12).toString('hex');
    const commission = Math.round(amount * (this.platformCommission / 100));

    const successBase = redirectSuccessUrl || process.env.NABIL_CALLBACK_SUCCESS_URL || '';
    const cancelBase = redirectCancelUrl || process.env.NABIL_CALLBACK_CANCEL_URL || '';

    if (this.sandboxMode) {
      const mockUrl = `${successBase}?payment=nabil&status=ok&stamp=${encodeURIComponent(stamp)}&transactionId=${encodeURIComponent(transactionId)}&sandbox=1`;
      return {
        href: mockUrl,
        stamp,
        transactionId,
        commission: {
          platformAmount: commission,
          merchantAmount: amount - commission,
          rate: this.platformCommission
        }
      };
    }

    if (!this.isConfigured()) {
      throw new Error('Nabil EPG is not configured. Set NABIL_EPG_* env vars or NABIL_SANDBOX_MODE=true for local dev.');
    }

    const headers = {
      'x-merchant-id': this.merchantId,
      'x-timestamp': new Date().toISOString(),
      'x-nonce': crypto.randomUUID()
    };

    const body = {
      merchantId: this.merchantId,
      orderId: stamp,
      transactionId,
      amount,
      currency: currency.toUpperCase(),
      customer: customer || {},
      successUrl: `${successBase}?payment=nabil&status=ok&stamp=${encodeURIComponent(stamp)}&transactionId=${encodeURIComponent(transactionId)}`,
      cancelUrl: `${cancelBase}?payment=nabil&status=cancel&stamp=${encodeURIComponent(stamp)}`,
      webhookUrl: process.env.NABIL_WEBHOOK_URL || `${successBase}?payment=nabil&webhook=1`
    };

    const bodyString = JSON.stringify(body);
    headers.signature = this.calculateHmac(headers, bodyString);

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
      throw new Error(`Nabil EPG API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const paymentUrl = result.paymentUrl || result.href || result.redirectUrl;

    if (!paymentUrl) {
      throw new Error('Nabil EPG did not return a payment URL');
    }

    return {
      href: paymentUrl,
      stamp,
      transactionId: result.transactionId || transactionId,
      commission: {
        platformAmount: commission,
        merchantAmount: amount - commission,
        rate: this.platformCommission
      }
    };
  }

  /**
   * Verify payment status with Nabil API (or sandbox always ok).
   */
  async verifyPaymentStatus(transactionId, stamp) {
    if (this.sandboxMode) {
      return { status: 'ok', transactionId, stamp };
    }

    if (!this.apiUrl) {
      throw new Error('NABIL_EPG_API_URL is required for payment verification');
    }

    const headers = {
      'x-merchant-id': this.merchantId,
      'x-timestamp': new Date().toISOString(),
      'x-nonce': crypto.randomUUID()
    };
    const path = `/payments/${encodeURIComponent(transactionId)}?stamp=${encodeURIComponent(stamp)}`;
    headers.signature = this.calculateHmac(headers, '');

    const response = await fetch(`${this.apiUrl}${path}`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Nabil verify error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const status = result.status || result.paymentStatus || 'unknown';
    return { status: String(status).toLowerCase(), transactionId, stamp, raw: result };
  }
}

export default new NabilPaymentService();

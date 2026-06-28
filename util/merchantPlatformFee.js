/**
 * Merchant-configured Stripe platform fee (cents) from otherInfo.stripe.
 */
export function getMerchantConfiguredStripePlatformFeeCents(merchant) {
    if (!merchant) return 0;
    const raw = typeof merchant.otherInfo?.get === 'function'
        ? merchant.otherInfo.get('stripe')
        : merchant?.otherInfo?.stripe;
    const fee = Math.round(Number(raw));
    return Number.isFinite(fee) && fee > 0 ? fee : 0;
}

/**
 * Resolve platform fee cents for Stripe payments (PI metadata, application fee, merchant config).
 */
export function resolveStripePlatformFeeCents({
    paymentIntent = null,
    stripeMetadata = {},
    merchant = null,
    fulfillment = {},
} = {}) {
    const fromPi = paymentIntent?.application_fee_amount;
    if (fromPi != null && Number(fromPi) > 0) {
        return Math.round(Number(fromPi));
    }
    const fromMeta = Number(stripeMetadata.platformFee || fulfillment.platformFee || 0);
    if (fromMeta > 0) {
        return Math.round(fromMeta);
    }
    return getMerchantConfiguredStripePlatformFeeCents(merchant);
}

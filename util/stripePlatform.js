/**
 * Resolve the platform Stripe Connect account ID used for direct (non-connected) charges.
 * EMS stores this as STRIPE_ACCOUNT_ID; FEB historically used STRIPE_PLATFORM_ACCOUNT_ID.
 */
export function getPlatformStripeAccountId() {
    return process.env.STRIPE_PLATFORM_ACCOUNT_ID
        || process.env.STRIPE_ACCOUNT_ID
        || null;
}

export function isPlatformStripeAccount(stripeAccount) {
    const platformId = getPlatformStripeAccountId();
    return Boolean(platformId && stripeAccount === platformId);
}

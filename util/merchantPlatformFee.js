/**
 * Merchant-configured Stripe platform fee (cents) from otherInfo.stripe.
 * This is a flat per-transaction fee, not multiplied by ticket quantity.
 */
import { info } from '../model/logger.js';

export function getMerchantConfiguredStripePlatformFeeCents(merchant) {
    if (!merchant) return 0;
    const raw = typeof merchant.otherInfo?.get === 'function'
        ? merchant.otherInfo.get('stripe')
        : merchant?.otherInfo?.stripe;
    const fee = Math.round(Number(raw));
    return Number.isFinite(fee) && fee > 0 ? fee : 0;
}

/** Env fallback when merchant has no configured Stripe platform fee (cents). */
export function getDefaultStripePlatformFeeCents() {
    const fee = Number(process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS || 0);
    return Number.isFinite(fee) && fee > 0 ? Math.round(fee) : 0;
}

/** Merchant config first, then env default — used at checkout and accounting publish. */
export function resolveConfiguredStripePlatformFeeCents(merchant) {
    return getMerchantConfiguredStripePlatformFeeCents(merchant) || getDefaultStripePlatformFeeCents();
}

function ticketInfoPlain(ticketInfo) {
    if (!ticketInfo) return {};
    if (ticketInfo instanceof Map) return Object.fromEntries(ticketInfo.entries());
    if (typeof ticketInfo === 'object') return ticketInfo;
    return {};
}

function parsePositiveInt(value, fallback = null) {
    if (value == null || value === '') return fallback;
    const parsed = parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
}

/**
 * Commerce order quantity from a ticket document (packs/orders, not admission headcount).
 */
export function resolveOrderQuantityFromTicket(ticket) {
    const ticketInfoData = ticketInfoPlain(ticket?.ticketInfo);

    const orderQty = parsePositiveInt(ticketInfoData.orderQuantity, null);
    if (orderQty) return orderQty;

    const admissionQty = parsePositiveInt(ticketInfoData.quantity, null) || 1;
    const packSize = parsePositiveInt(ticketInfoData.packSize, null) || 1;

    if (packSize > 1 && admissionQty >= packSize) {
        return Math.max(1, Math.round(admissionQty / packSize));
    }

    return admissionQty;
}

/**
 * Platform fee is charged once per payment transaction. If a stored value was
 * accidentally scaled by order quantity, normalize back to the per-transaction fee.
 */
export function normalizePerTransactionPlatformFeeCents(feeCents, {
    orderQuantity = 1,
    configuredFeeCents = 0,
} = {}) {
    const fee = Math.round(Number(feeCents || 0));
    if (fee <= 0) return 0;

    const qty = Math.max(1, Math.round(Number(orderQuantity) || 1));
    if (qty <= 1) return fee;

    const configured = Math.round(Number(configuredFeeCents || 0));
    if (configured <= 0) return fee;

    const scaled = configured * qty;
    if (fee === scaled) return configured;
    if (fee % configured === 0 && fee / configured === qty) return configured;

    return fee;
}

/**
 * Resolve platform fee cents for Stripe payments (PI application fee, metadata, merchant config).
 * Always returns a flat per-transaction amount.
 */
export function resolveStripePlatformFeeCents({
    paymentIntent = null,
    stripeMetadata = {},
    merchant = null,
    fulfillment = {},
    orderQuantity = 1,
} = {}) {
    const merchantConfiguredFeeCents = getMerchantConfiguredStripePlatformFeeCents(merchant);
    let feeCents = 0;

    const fromPi = paymentIntent?.application_fee_amount;
    if (fromPi != null && Number(fromPi) > 0) {
        feeCents = Math.round(Number(fromPi));
    } else {
        const fromMeta = Number(stripeMetadata.platformFee || fulfillment.platformFee || 0);
        if (fromMeta > 0) {
            feeCents = Math.round(fromMeta);
        } else {
            feeCents = resolveConfiguredStripePlatformFeeCents(merchant);
        }
    }

    const normalized = normalizePerTransactionPlatformFeeCents(feeCents, {
        orderQuantity,
        configuredFeeCents: merchantConfiguredFeeCents,
    });

    if (normalized !== feeCents && feeCents > 0) {
        info('[merchantPlatformFee] Normalized qty-scaled platform fee %d -> %d (orderQty=%d, configured=%d)',
            feeCents, normalized, orderQuantity, merchantConfiguredFeeCents);
    }

    return normalized;
}

export const PLATFORM_FEE_BASIS = 'per_transaction';

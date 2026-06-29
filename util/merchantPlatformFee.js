/**
 * Platform fee helpers.
 * Checkout (createPaymentIntent) may compute Stripe application_fee_amount.
 * Ledger / RabbitMQ must only read values already stored on the ticket.
 */
export const PLATFORM_FEE_BASIS = 'per_order_quantity';

export function getMerchantConfiguredStripePlatformFeeCents(merchant) {
    if (!merchant) return 0;
    const raw = typeof merchant.otherInfo?.get === 'function'
        ? merchant.otherInfo.get('stripe')
        : merchant?.otherInfo?.stripe;
    const fee = Math.round(Number(raw));
    return Number.isFinite(fee) && fee > 0 ? fee : 0;
}

export function getDefaultStripePlatformFeeCents() {
    const fee = Number(process.env.ACCOUNTING_DEFAULT_PLATFORM_FEE_CENTS || 0);
    return Number.isFinite(fee) && fee > 0 ? Math.round(fee) : 0;
}

/** Used at checkout PI creation only — not for ledger. */
export function resolveConfiguredStripePlatformFeeCents(merchant) {
    return getMerchantConfiguredStripePlatformFeeCents(merchant) || getDefaultStripePlatformFeeCents();
}

export function ticketInfoPlain(ticketInfo) {
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

/** Checkout metadata before ticket exists — PI creation only. */
export function resolveOrderQuantityFromMetadata(metadata = {}) {
    const fromOrderQty = parsePositiveInt(metadata?.orderQuantity, null);
    if (fromOrderQty) return fromOrderQty;
    return parsePositiveInt(metadata?.quantity, 1) || 1;
}

/** Checkout PI creation only — not for ledger. */
export function scalePlatformFeeByOrderQuantity(unitFeeCents, orderQuantity = 1) {
    const unit = Math.round(Number(unitFeeCents || 0));
    if (unit <= 0) return 0;
    const qty = Math.max(1, Math.round(Number(orderQuantity) || 1));
    return unit * qty;
}

/** Read a ticketInfo field as stored — no defaults, no derivation. */
export function readTicketInfoValue(ticket, field) {
    const raw = ticketInfoPlain(ticket?.ticketInfo)[field];
    if (raw == null || raw === '') return null;
    return raw;
}

/** Read a positive int field from ticketInfo — null when not recorded. */
export function readTicketInfoStoredInt(ticket, field) {
    const raw = readTicketInfoValue(ticket, field);
    if (raw == null) return null;
    const parsed = parseInt(String(raw), 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

/** orderQuantity from ticket only. */
export function resolveOrderQuantityFromTicket(ticket) {
    return readTicketInfoStoredInt(ticket, 'orderQuantity');
}

/** admission quantity (ticketInfo.quantity) from ticket only. */
export function resolveAdmissionQuantityFromTicket(ticket) {
    return readTicketInfoStoredInt(ticket, 'quantity');
}

/** Platform fee cents recorded on the ticket (Stripe platformFee or Paytrail/Nabil commission). */
export function readRecordedPlatformFeeCents(ticket) {
    const info = ticketInfoPlain(ticket?.ticketInfo);

    if (info.platformFee != null && info.platformFee !== '') {
        const fee = Number(info.platformFee);
        if (Number.isFinite(fee) && fee >= 0) return Math.round(fee);
    }

    const commission = info.platformCommission;
    if (commission == null || commission === '') return 0;

    if (typeof commission === 'object') {
        const cents = Number(commission.platformAmount ?? commission.platform_amount ?? 0);
        return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
    }

    const num = Number(commission);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.round(num);
}

/** Unit platform fee (cents) for ledger: ticket unit field → merchant → env. */
export function resolvePublishedUnitPlatformFeeCents(ticket, merchant = null) {
    const fromTicket = Number(readTicketInfoValue(ticket, 'platformFeeUnitCents') || 0);
    if (Number.isFinite(fromTicket) && fromTicket > 0) return Math.round(fromTicket);
    const fromMerchant = getMerchantConfiguredStripePlatformFeeCents(merchant);
    if (fromMerchant > 0) return fromMerchant;
    return getDefaultStripePlatformFeeCents();
}

/**
 * When only ticket.platformFee is present (no unit field), decide if it is per-unit or already scaled.
 */
function resolveRecordedPlatformFeeForPerOrderQuantity(recorded, orderQty, merchant) {
    const grossQty = Math.max(1, Math.round(Number(orderQty) || 1));
    if (grossQty === 1) {
        return recorded;
    }

    const scaledFromRecorded = scalePlatformFeeByOrderQuantity(recorded, grossQty);
    const configuredUnit = getMerchantConfiguredStripePlatformFeeCents(merchant)
        || getDefaultStripePlatformFeeCents();

    if (configuredUnit > 0) {
        if (recorded <= configuredUnit) {
            return scaledFromRecorded;
        }
        const expectedTotal = scalePlatformFeeByOrderQuantity(configuredUnit, grossQty);
        if (recorded === expectedTotal) {
            return recorded;
        }
    }

    // Legacy tickets stored the unit fee in platformFee without scaling.
    return scaledFromRecorded;
}

/**
 * Ledger platform fee cents.
 * Stripe per_order_quantity: unit × orderQuantity (ignores flat platformFee on ticket).
 * Paytrail/Nabil: recorded commission on ticket.
 */
export function resolvePublishedPlatformFeeCents(ticket, merchant = null, { grossCents = 0, method = 'stripe' } = {}) {
    const normalizedMethod = String(method || '').toLowerCase();
    if (normalizedMethod === 'free' || grossCents <= 0) return 0;

    if (normalizedMethod === 'paytrail' || normalizedMethod === 'nabil') {
        const recorded = readRecordedPlatformFeeCents(ticket);
        return recorded > 0 ? Math.min(recorded, Math.round(grossCents)) : 0;
    }

    const basis = readTicketInfoValue(ticket, 'platformFeeBasis') || PLATFORM_FEE_BASIS;
    const orderQty = resolveOrderQuantityFromTicket(ticket) ?? 1;
    const gross = Math.round(grossCents);

    if (basis !== PLATFORM_FEE_BASIS) {
        const recorded = readRecordedPlatformFeeCents(ticket);
        return recorded > 0 ? Math.min(recorded, gross) : 0;
    }

    let unitFee = resolvePublishedUnitPlatformFeeCents(ticket, merchant);
    const recorded = readRecordedPlatformFeeCents(ticket);

    if (unitFee <= 0 && recorded > 0) {
        const fee = resolveRecordedPlatformFeeForPerOrderQuantity(recorded, orderQty, merchant);
        return Math.min(fee, gross);
    }

    if (unitFee > 0) {
        return Math.min(scalePlatformFeeByOrderQuantity(unitFee, orderQty), gross);
    }

    return 0;
}

/** Copy platform fee fields from payment intent / metadata onto ticketInfo at checkout. */
export function copyRecordedPlatformFeeToTicketInfo(ticketInfo, {
    paymentIntent = null,
    stripeMetadata = {},
    fulfillment = {},
} = {}) {
    const fromPi = paymentIntent?.application_fee_amount;
    if (fromPi != null && fromPi !== '') {
        const fee = Number(fromPi);
        if (Number.isFinite(fee) && fee >= 0) {
            ticketInfo.platformFee = Math.round(fee);
        }
    } else {
        const metaFee = stripeMetadata.platformFee ?? fulfillment.platformFee;
        if (metaFee != null && metaFee !== '') {
            const fee = Number(metaFee);
            if (Number.isFinite(fee) && fee >= 0) {
                ticketInfo.platformFee = Math.round(fee);
            }
        }
    }

    const unit = stripeMetadata.platformFeeUnitCents ?? fulfillment.platformFeeUnitCents;
    if (unit != null && unit !== '') {
        ticketInfo.platformFeeUnitCents = String(unit);
    }

    const basis = stripeMetadata.platformFeeBasis ?? fulfillment.platformFeeBasis;
    if (basis) {
        ticketInfo.platformFeeBasis = basis;
    }
}

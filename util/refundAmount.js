export const ticketInfoToPlain = (ticketInfo) => {
    if (!ticketInfo) return {};
    if (ticketInfo instanceof Map) return Object.fromEntries(ticketInfo);
    return typeof ticketInfo === 'object' ? ticketInfo : {};
};

export const resolvePaidAmountCents = (ticket, ticketInfo) => {
    const info = ticketInfo || ticketInfoToPlain(ticket?.ticketInfo);
    if (info.amountCents) return Number(info.amountCents);
    if (info.totalPrice != null) return Math.round(Number(info.totalPrice) * 100);
    if (info.totalAmount != null) return Math.round(Number(info.totalAmount) * 100);
    if (info.price != null) {
        const qty = Number(info.quantity || info.orderQuantity || 1) || 1;
        return Math.round(Number(info.price) * qty * 100);
    }
    return 0;
};

export const computeRemainingRefundableCents = (ticket) => {
    const ticketInfo = ticketInfoToPlain(ticket?.ticketInfo);
    const paidAmountCents = resolvePaidAmountCents(ticket, ticketInfo);
    const alreadyRefunded = Number(ticket?.refundAmount || 0);
    return Math.max(0, paidAmountCents - alreadyRefunded);
};

const STRIPE_REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);

export const mapToStripeRefundReason = (reason) => {
    if (!reason || typeof reason !== 'string') return undefined;
    const normalized = reason.trim().toLowerCase();
    if (STRIPE_REFUND_REASONS.has(normalized)) return normalized;
    return 'requested_by_customer';
};

import { roundMoney } from './money.js';
import { computeTicketInfoOrderPricing } from './couponPricing.js';

export const parseTicketInfoMoney = (value, fallback = 0) => {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Extract discount display fields from ticketInfo (plain object or Map entry).
 */
export function getTicketDiscountDisplay(ticketInfo) {
    if (!ticketInfo || typeof ticketInfo !== 'object') return null;

    const couponCode = ticketInfo.couponCode != null ? String(ticketInfo.couponCode).trim() : '';
    const couponDiscountAmount = parseTicketInfoMoney(ticketInfo.couponDiscountAmount);
    if (!couponCode || couponDiscountAmount <= 0) return null;

    const orderQty = Math.max(1, parseInt(String(ticketInfo.orderQuantity ?? ticketInfo.quantity ?? '1'), 10) || 1);
    const postDiscountBase = parseTicketInfoMoney(ticketInfo.totalBasePrice)
        || roundMoney(parseTicketInfoMoney(ticketInfo.basePrice) * orderQty);

    const catalogTotalBasePrice = parseTicketInfoMoney(ticketInfo.catalogTotalBasePrice) > 0
        ? parseTicketInfoMoney(ticketInfo.catalogTotalBasePrice)
        : roundMoney(postDiscountBase + couponDiscountAmount);

    return {
        couponCode,
        couponId: ticketInfo.couponId != null ? String(ticketInfo.couponId) : null,
        couponDiscountAmount,
        catalogTotalBasePrice,
        postDiscountBaseTotal: postDiscountBase,
    };
}

/**
 * When checkout sends couponCode/couponId only, recompute discount server-side
 * so ticketInfo/email/UI can show the applied code and amount.
 */
export function enrichMetadataWithCouponPricing(metadata = {}, event, ticketTypeConfig) {
    if (!metadata || typeof metadata !== 'object') return metadata;

    const couponCode = metadata.couponCode != null ? String(metadata.couponCode).trim() : '';
    if (!couponCode || !event || !ticketTypeConfig) return metadata;

    const existingDiscount = parseTicketInfoMoney(metadata.couponDiscountAmount);
    const existingCatalog = parseTicketInfoMoney(metadata.catalogBaseSubtotal);
    if (existingDiscount > 0 && existingCatalog > 0) {
        return metadata;
    }

    const qty = Math.max(1, parseInt(String(metadata.quantity ?? '1'), 10) || 1);
    const pricing = computeTicketInfoOrderPricing(ticketTypeConfig, event, qty, metadata);
    if (!pricing.couponCode || pricing.couponDiscountAmount <= 0) {
        return metadata;
    }

    return {
        ...metadata,
        couponCode: pricing.couponCode,
        couponId: pricing.couponId ?? metadata.couponId,
        couponDiscountAmount: pricing.couponDiscountAmount,
        catalogBaseSubtotal: pricing.catalogBaseSubtotal,
    };
}

/** Persist coupon transparency fields on ticketInfo from checkout metadata. */
export function attachCouponFieldsToTicketInfo(ticketInfo, metadata = {}) {
    if (!ticketInfo || typeof ticketInfo !== 'object') return ticketInfo;

    const couponCode = metadata.couponCode != null ? String(metadata.couponCode).trim() : '';
    const couponDiscountAmount = parseTicketInfoMoney(metadata.couponDiscountAmount);
    if (!couponCode || couponDiscountAmount <= 0) return ticketInfo;

    ticketInfo.couponCode = couponCode;
    if (metadata.couponId != null && String(metadata.couponId).trim()) {
        ticketInfo.couponId = String(metadata.couponId).trim();
    }

    ticketInfo.couponDiscountAmount = couponDiscountAmount;

    const orderQty = Math.max(1, parseInt(String(metadata.quantity ?? ticketInfo.orderQuantity ?? ticketInfo.quantity ?? '1'), 10) || 1);
    const postDiscountBase = parseTicketInfoMoney(ticketInfo.totalBasePrice)
        || parseTicketInfoMoney(metadata.totalBasePrice)
        || roundMoney(parseTicketInfoMoney(ticketInfo.basePrice ?? metadata.basePrice) * orderQty);

    ticketInfo.catalogTotalBasePrice = parseTicketInfoMoney(metadata.catalogBaseSubtotal) > 0
        ? parseTicketInfoMoney(metadata.catalogBaseSubtotal)
        : roundMoney(postDiscountBase + couponDiscountAmount);

    return ticketInfo;
}

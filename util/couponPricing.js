import { computeTicketLinePricing, roundMoney } from './money.js';

export function normalizeCouponCode(code) {
  return String(code || '').trim().toUpperCase();
}

const parseMoneyField = (value, fallback = 0) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** True when the event has at least one active discount code with uses remaining. */
export function eventHasActiveDiscountCodes(discountCodes) {
  if (!Array.isArray(discountCodes)) return false;
  return discountCodes.some((c) => {
    if (c?.active === false) return false;
    const usesLeft = Number(c?.uses_left ?? c?.usesLeft ?? 0);
    return usesLeft > 0;
  });
}

export function findCouponOnEvent(event, code) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;
  let list = event?.discountCodes ?? event?._doc?.discountCodes;
  if (!Array.isArray(list) && event && typeof event.toObject === 'function') {
    list = event.toObject().discountCodes;
  }
  if (!Array.isArray(list)) return null;
  return list.find((c) => normalizeCouponCode(c.code) === normalized) || null;
}

export function validateCouponOnEvent(event, code) {
  const coupon = findCouponOnEvent(event, code);
  if (!coupon) {
    return { valid: false, error: 'Invalid discount code' };
  }
  if (coupon.active === false) {
    return { valid: false, error: 'This discount code is no longer active' };
  }
  const usesLeft = Number(coupon.uses_left ?? coupon.usesLeft ?? 0);
  if (usesLeft <= 0) {
    return { valid: false, error: 'This discount code has no uses remaining' };
  }
  return {
    valid: true,
    coupon: {
      id: String(coupon.id),
      code: normalizeCouponCode(coupon.code),
      name: coupon.name || '',
      discount_type: coupon.discount_type === 'percentage' ? 'percentage' : 'fixed',
      discount_value: Number(coupon.discount_value ?? 0),
      uses_left: usesLeft
    }
  };
}

export function computeDiscountAmount(coupon, baseSubtotal) {
  const base = Math.max(0, Number(baseSubtotal) || 0);
  if (!coupon || base <= 0) return 0;

  let amount = 0;
  if (coupon.discount_type === 'percentage') {
    amount = (base * Number(coupon.discount_value)) / 100;
  } else {
    amount = Number(coupon.discount_value);
  }
  return roundMoney(Math.min(Math.max(0, amount), base));
}

/** Order base subtotal from catalog ticket price — never from client-discounted totals. */
export function getBaseSubtotalForCoupon(ticket, event, quantity, metadata = {}) {
  const qty = Math.max(1, parseInt(metadata.quantity || quantity, 10) || 1);
  const isPricingConfiguration = event?.venue?.pricingModel === 'pricing_configuration';

  if (isPricingConfiguration && metadata.totalBasePrice != null) {
    const parsed = parseFloat(metadata.totalBasePrice);
    if (!Number.isNaN(parsed)) {
      return roundMoney(parsed);
    }
  }

  const ticketPrice = parseMoneyField(ticket?.price);
  return roundMoney(ticketPrice * qty);
}

/** Resolve fee/tax rates: ticket DB first, metadata fallback (checkout sends tax from ticket modal). */
export function resolveTicketPricingRates(ticket, metadata = {}) {
  const serviceFee = parseMoneyField(ticket?.serviceFee, parseMoneyField(metadata?.serviceFee));
  const entertainmentTax = parseMoneyField(ticket?.entertainmentTax, parseMoneyField(metadata?.entertainmentTax));
  const metadataTaxRate =
    parseMoneyField(metadata?.entertainmentTax) ||
    parseMoneyField(metadata?.vatRate) ||
    parseMoneyField(metadata?.vat);
  const vatRate = entertainmentTax || parseMoneyField(ticket?.vat) || metadataTaxRate || 0;
  const serviceTax = parseMoneyField(ticket?.serviceTax, parseMoneyField(metadata?.serviceTax));
  const orderFee = parseMoneyField(ticket?.orderFee, parseMoneyField(metadata?.orderFee));

  return { serviceFee, vatRate, serviceTax, orderFee };
}

/**
 * Authoritative ticket_info checkout pricing.
 * When metadata.couponCode is set: validate on event, discount base only, recalculate all line items server-side.
 * Ignores client couponDiscountAmount and discounted totals.
 */
export function computeTicketInfoOrderPricing(ticket, event, quantity, metadata = {}) {
  const qty = Math.max(1, parseInt(metadata.quantity || quantity, 10) || 1);
  const catalogUnitBase = parseMoneyField(ticket?.price);
  const catalogBaseSubtotal = roundMoney(catalogUnitBase * qty);
  const rates = resolveTicketPricingRates(ticket, metadata);

  let couponCode = null;
  let couponId = null;
  let couponDiscountAmount = 0;
  let effectiveUnitBase = catalogUnitBase;

  const normalizedCouponCode =
    metadata.couponCode != null ? normalizeCouponCode(String(metadata.couponCode)) : '';

  if (normalizedCouponCode) {
    if (!event) {
      throw new Error('Invalid discount code');
    }
    const couponValidation = validateCouponOnEvent(event, normalizedCouponCode);
    if (!couponValidation.valid) {
      throw new Error(couponValidation.error || 'Invalid discount code');
    }
    couponDiscountAmount = computeDiscountAmount(
      couponValidation.coupon,
      catalogBaseSubtotal
    );
    const discountedBase = roundMoney(Math.max(0, catalogBaseSubtotal - couponDiscountAmount));
    effectiveUnitBase = roundMoney(discountedBase / qty);
    couponCode = couponValidation.coupon.code;
    couponId = couponValidation.coupon.id;
  } else if (parseMoneyField(metadata.couponDiscountAmount) > 0) {
    throw new Error('Invalid discount code');
  }

  const line = computeTicketLinePricing({
    basePrice: effectiveUnitBase,
    serviceFee: rates.serviceFee,
    vatRatePercent: rates.vatRate,
    serviceTaxRatePercent: rates.serviceTax,
    orderFee: rates.orderFee,
    quantity: qty
  });

  return {
    ...line,
    totalAmount: line.total,
    catalogUnitBase,
    catalogBaseSubtotal,
    effectiveUnitBase,
    couponCode,
    couponId,
    couponDiscountAmount,
    vatRate: rates.vatRate,
    serviceTaxRate: rates.serviceTax
  };
}

/** @deprecated Use computeTicketInfoOrderPricing — kept for callers that patch metadata only. */
export function applyCouponDiscountToMetadata(metadata, ticket, event, quantity, coupon) {
  const pricing = computeTicketInfoOrderPricing(
    ticket,
    event,
    quantity,
    { ...metadata, couponCode: coupon?.code }
  );
  return {
    ...metadata,
    couponCode: pricing.couponCode,
    couponId: pricing.couponId,
    couponDiscountAmount: pricing.couponDiscountAmount,
    _couponDiscountAmount: pricing.couponDiscountAmount,
    _couponBaseSubtotal: pricing.catalogBaseSubtotal,
    _couponEffectiveUnitBase: pricing.effectiveUnitBase,
    totalBasePrice: pricing.totalBasePrice,
    totalServiceFee: pricing.totalServiceFee,
    totalVatAmount: pricing.totalVatAmount,
    totalAmount: pricing.totalAmount
  };
}

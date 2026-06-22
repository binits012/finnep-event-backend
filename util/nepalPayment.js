export const NEPAL_COUNTRY_NAMES = new Set(['nepal', 'np']);

export function isNepalCountry(country) {
  if (!country || typeof country !== 'string') return false;
  return NEPAL_COUNTRY_NAMES.has(country.trim().toLowerCase());
}

export function isDualPaymentMerchant(merchant) {
  if (!merchant) return false;
  return Boolean(merchant.nabilEnabled ?? merchant.nabil_enabled);
}

export function resolveAvailablePaymentProviders(merchant) {
  const providers = ['stripe'];
  if (merchant?.paytrailEnabled) providers.push('paytrail');
  if (isDualPaymentMerchant(merchant)) providers.push('nabil');
  return providers;
}

export function normalizeStripeCurrencyCode(raw, fallback = 'eur') {
  const code = String(raw || fallback).trim().toLowerCase();
  return /^[a-z]{3}$/.test(code) ? code : fallback;
}

/** Event-level stripeCurrency wins; per-ticket override supported; defaults to eur. */
export function resolveStripeCurrency(ticket, event = null) {
  const fromTicket = ticket?.stripeCurrency ?? ticket?.stripe_currency;
  const fromEvent =
    event?.stripeCurrency ??
    event?.stripe_currency ??
    event?.otherInfo?.stripeCurrency;
  return normalizeStripeCurrencyCode(fromTicket || fromEvent || 'eur');
}

export function assertDualPaymentV1Allowed({ merchant, event, metadata = {} }) {
  if (!isDualPaymentMerchant(merchant)) return null;

  if (metadata.couponCode || metadata.couponId || metadata.couponDiscountAmount) {
    return 'Coupons are not supported for dual-payment (Nepal) events in v1';
  }

  const hasSeats =
    (metadata.placeIds && (Array.isArray(metadata.placeIds) ? metadata.placeIds.length : metadata.placeIds)) ||
    (metadata.seatTickets && (Array.isArray(metadata.seatTickets) ? metadata.seatTickets.length : metadata.seatTickets)) ||
    event?.isSeatedEvent ||
    event?.venue?.hasSeatSelection ||
    event?.venue?.venueId;

  if (hasSeats) {
    return 'Seated events are not supported for dual-payment (Nepal) merchants in v1';
  }

  return null;
}

/**
 * Pick unit base price + currency for provider-specific checkout.
 * stripePrice is major units in stripeCurrency (not Stripe API cents).
 * @returns {{ unitBase: number, currency: string }}
 */
export function resolveProviderTicketPricing(ticket, paymentProvider, event = null) {
  if (paymentProvider === 'nabil') {
    return {
      unitBase: Number(ticket?.price) || 0,
      currency: (ticket?.currency || 'npr').toLowerCase()
    };
  }
  if (paymentProvider === 'stripe' && (ticket?.stripePrice != null || ticket?.stripe_price != null)) {
    const stripePrice = ticket.stripePrice ?? ticket.stripe_price;
    return {
      unitBase: Number(stripePrice),
      currency: resolveStripeCurrency(ticket, event)
    };
  }
  return {
    unitBase: Number(ticket?.price) || 0,
    currency: (ticket?.currency || 'eur').toLowerCase()
  };
}

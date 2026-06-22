import { generateICS, generateQRCode, loadEmailTemplate } from './common.js'
import { resolvePlatformBrandingAsync } from './platformSettings.js'
import { resolveSiloEmailBranding } from './siloEmailSettings.js'
import * as Ticket from '../model/ticket.js'
import { error, warn } from '../model/logger.js'
import { forward } from './sendMail.js'
import dotenv from 'dotenv'
import moment from 'moment-timezone'
dotenv.config()
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))

import { roundMoney } from './money.js';
import { getTicketDiscountDisplay } from './ticketDiscountDisplay.js';

/**
 * Format currency amount (2 decimal places, rounded after each value).
 */
const formatCurrency = (amount, currency = 'EUR') => {
    if (amount === null || amount === undefined || isNaN(amount)) return '0.00';
    const rounded = roundMoney(amount);
    if (isNaN(rounded)) return '0.00';
    return rounded.toFixed(2);
};

const formatFinalCurrency = (amount, currency = 'EUR') => formatCurrency(amount, currency);

/**
 * Format date for display
 */
const formatEventDate = (eventDate, timezone = 'Europe/Helsinki') => {
    if (!eventDate) return '';
    return moment(eventDate).tz(timezone).format('dddd, MMMM D, YYYY');
};

/**
 * Format time for display
 */
const formatEventTime = (eventDate, timezone = 'Europe/Helsinki') => {
    if (!eventDate) return '';
    return moment(eventDate).tz(timezone).format('h:mm A');
};

/**
 * Format purchase date with time and UTC indication
 */
const formatPurchaseDate = (date) => {
    if (!date) {
        const now = new Date();
        return moment.utc(now).format('MMMM D, YYYY [at] h:mm A [UTC]');
    }
    // Format date with time and UTC indication
    return moment.utc(date).format('MMMM D, YYYY [at] h:mm A [UTC]');
};

/**
 * Get currency symbol
 */
const getCurrencySymbol = (currency = 'EUR') => {
    // Stripe-supported currencies with their symbols
    const symbols = {
        // Major currencies
        'EUR': '€',
        'USD': '$',
        'GBP': '£',
        'JPY': '¥',
        'AUD': 'A$',
        'CAD': 'C$',
        'CHF': 'CHF',
        'CNY': '¥',
        'HKD': 'HK$',
        'NZD': 'NZ$',
        'SGD': 'S$',
        // Nordic
        'SEK': 'kr',
        'NOK': 'kr',
        'DKK': 'kr',
        // European
        'PLN': 'zł',
        'CZK': 'Kč',
        'HUF': 'Ft',
        'RON': 'lei',
        'BGN': 'лв',
        'HRK': 'kn',
        // Asia-Pacific
        'INR': '₹',
        'THB': '฿',
        'MYR': 'RM',
        'PHP': '₱',
        'IDR': 'Rp',
        'KRW': '₩',
        'VND': '₫',
        // Americas
        'BRL': 'R$',
        'MXN': '$',
        'ARS': '$',
        'CLP': '$',
        'COP': '$',
        'PEN': 'S/',
        // Middle East & Africa
        'ILS': '₪',
        'AED': 'د.إ',
        'SAR': '﷼',
        'ZAR': 'R',
        'EGP': 'E£',
        'NGN': '₦',
        // Other major
        'RUB': '₽',
        'TRY': '₺'
    };
    return symbols[currency.toUpperCase()] || currency;
};

/**
 * Build venue map link
 * Handles coordinates (lat,lng), full URLs, or address strings
 */
const buildVenueMapLink = (venue, geoCode = null) => {
    // If geoCode is provided, check if it's coordinates or a URL
    if (geoCode) {
        // Check if it's already a valid URL
        if (geoCode.startsWith('http://') || geoCode.startsWith('https://')) {
            return geoCode;
        }
        // Check if it's coordinates (latitude,longitude)
        if (geoCode.includes(',')) {
            const [lat, lng] = geoCode.split(',').map(coord => coord.trim());
            // Validate coordinates are numbers
            if (!isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
                return `https://www.google.com/maps?q=${lat},${lng}`;
            }
        }
    }

    // Fallback to address-based search
    if (!venue) return '#';
    const address = venue.address || venue.name || '';
    if (!address) return '#';
    return `https://www.google.com/maps?q=${encodeURIComponent(address)}`;
};

const ticketInfoToPlainObject = (ticketInfo) => {
    if (!ticketInfo) return {};
    if (ticketInfo instanceof Map) return Object.fromEntries(ticketInfo);
    if (typeof ticketInfo === 'object') return { ...ticketInfo };
    return {};
};

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const pickFirstFinite = (...values) => {
    for (const value of values) {
        const parsed = parseFloat(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return NaN;
};

const resolveTicketEmailPricing = ({ ticketInfoData, event }) => {
    const basePrice = toFiniteNumber(ticketInfoData.basePrice, toFiniteNumber(ticketInfoData.price, 0));
    const serviceFee = toFiniteNumber(ticketInfoData.serviceFee, 0);
    const quantity = parseInt(String(ticketInfoData.quantity || '1'), 10) || 1;
    const orderFee = toFiniteNumber(ticketInfoData.orderFee, 0);
    let entertainmentTax = toFiniteNumber(ticketInfoData.entertainmentTax, 0);
    let serviceTax = toFiniteNumber(ticketInfoData.serviceTax, 0);
    const vat = toFiniteNumber(ticketInfoData.vat, 0);
    let vatRate = toFiniteNumber(ticketInfoData.vatRate, vat);

    let seatTickets = ticketInfoData.seatTickets;
    if (typeof seatTickets === 'string') {
        try {
            seatTickets = JSON.parse(seatTickets);
        } catch (e) {
            seatTickets = null;
        }
    }
    const hasSeatTickets = Array.isArray(seatTickets) && seatTickets.length > 0;

    let totalBasePrice = toFiniteNumber(ticketInfoData.totalBasePrice, NaN);
    let totalServiceFee = toFiniteNumber(ticketInfoData.totalServiceFee, NaN);
    let totalEntertainmentTaxAmount = toFiniteNumber(ticketInfoData.entertainmentTaxAmount, NaN);
    let totalServiceTaxAmount = toFiniteNumber(ticketInfoData.serviceTaxAmount, NaN);
    let totalVatAmount = toFiniteNumber(
        pickFirstFinite(ticketInfoData.totalVatAmount, ticketInfoData.vatAmount),
        NaN
    );

    const hasStoredTotals = [
        totalBasePrice,
        totalServiceFee,
        totalEntertainmentTaxAmount,
        totalServiceTaxAmount,
        totalVatAmount
    ].every(Number.isFinite);

    // Legacy fallback: if totals are missing for seated tickets, derive from seat definitions.
    if (!hasStoredTotals && hasSeatTickets && Array.isArray(event?.ticketInfo)) {
        totalBasePrice = 0;
        totalServiceFee = 0;
        totalEntertainmentTaxAmount = 0;
        totalServiceTaxAmount = 0;
        totalVatAmount = 0;

        let firstSeatEntertainmentTax = entertainmentTax;
        let firstSeatServiceTax = serviceTax;

        seatTickets.forEach((seatTicket, index) => {
            const seatTicketId = seatTicket?.ticketId;
            if (!seatTicketId) return;
            const seatTicketConfig = event.ticketInfo.find(t => t._id?.toString() === seatTicketId.toString());
            if (!seatTicketConfig) return;

            const seatBasePrice = toFiniteNumber(seatTicketConfig.price, 0);
            const seatServiceFee = toFiniteNumber(seatTicketConfig.serviceFee, 0);
            const seatEntertainmentTax = toFiniteNumber(seatTicketConfig.entertainmentTax, 0);
            const seatServiceTax = toFiniteNumber(seatTicketConfig.serviceTax, 0);
            const seatVatRate = toFiniteNumber(seatTicketConfig.vatRate, vatRate);

            if (index === 0) {
                firstSeatEntertainmentTax = seatEntertainmentTax;
                firstSeatServiceTax = seatServiceTax;
            }

            totalBasePrice += seatBasePrice;
            totalServiceFee += seatServiceFee;
            totalEntertainmentTaxAmount += (seatBasePrice * seatEntertainmentTax) / 100;
            totalServiceTaxAmount += (seatServiceFee * seatServiceTax) / 100;
            totalVatAmount += (seatBasePrice * seatVatRate) / 100;
        });

        entertainmentTax = firstSeatEntertainmentTax;
        serviceTax = firstSeatServiceTax;
    } else {
        // Non-seated + stored-values-first behavior.
        totalBasePrice = Number.isFinite(totalBasePrice) ? totalBasePrice : (basePrice * quantity);
        totalServiceFee = Number.isFinite(totalServiceFee) ? totalServiceFee : (serviceFee * quantity);
        totalEntertainmentTaxAmount = Number.isFinite(totalEntertainmentTaxAmount)
            ? totalEntertainmentTaxAmount
            : ((basePrice * entertainmentTax) / 100) * quantity;
        totalServiceTaxAmount = Number.isFinite(totalServiceTaxAmount)
            ? totalServiceTaxAmount
            : ((serviceFee * serviceTax) / 100) * quantity;
        totalVatAmount = Number.isFinite(totalVatAmount)
            ? totalVatAmount
            : ((basePrice * vatRate) / 100) * quantity;
    }

    if (totalVatAmount === 0 && totalEntertainmentTaxAmount > 0) {
        totalVatAmount = totalEntertainmentTaxAmount;
        if (vatRate === 0 && entertainmentTax > 0) {
            vatRate = entertainmentTax;
        }
    }

    if (totalVatAmount > 0 && (vatRate === 0 || !vatRate) && totalBasePrice > 0) {
        const calculatedVatRate = (totalVatAmount / totalBasePrice) * 100;
        if (calculatedVatRate > 0 && !isNaN(calculatedVatRate)) {
            vatRate = calculatedVatRate;
        }
    }

    const orderFeeServiceTax = Number.isFinite(toFiniteNumber(ticketInfoData.orderFeeServiceTax, NaN))
        ? toFiniteNumber(ticketInfoData.orderFeeServiceTax, 0)
        : roundMoney((orderFee * serviceTax) / 100);

    const storedPaidTotal = pickFirstFinite(
        ticketInfoData.totalAmount,
        ticketInfoData.totalPrice,
        ticketInfoData.price
    );
    const hasAuthoritativePaidTotal = Number.isFinite(storedPaidTotal);
    const totalAmount = hasAuthoritativePaidTotal
        ? roundMoney(storedPaidTotal)
        : roundMoney(totalBasePrice + totalServiceFee + totalServiceTaxAmount + totalVatAmount + orderFee + orderFeeServiceTax);

    return {
        basePrice,
        serviceFee,
        quantity,
        orderFee,
        entertainmentTax,
        serviceTax,
        vatRate,
        seatTickets,
        totalBasePrice,
        totalServiceFee,
        totalEntertainmentTaxAmount,
        totalServiceTaxAmount,
        totalVatAmount,
        orderFeeServiceTax,
        totalAmount,
        usedFallbackTotal: !hasAuthoritativePaidTotal
    };
};

/**
 * Create child QR records for grouped tickets (quantity > 1 admissions).
 * Idempotent: reuses existing childQRCodes entries when indices match.
 */
export const provisionGroupChildQRCodes = async (ticket, event, admissionQuantity, metadata = {}) => {
    if (!ticket) {
        throw new Error('Cannot provision child QR codes: ticket is missing');
    }
    const ticketId = ticket.id || ticket._id;
    const quantity = parseInt(String(admissionQuantity), 10) || 1;
    const ticketInfoData = ticketInfoToPlainObject(ticket.ticketInfo);

    if (quantity <= 1) {
        return { childQRCodes: [], ticketInfo: ticketInfoData };
    }

    const existing = Array.isArray(ticketInfoData.childQRCodes) ? ticketInfoData.childQRCodes : [];
    const childQRCodes = [];

    for (let childIndex = 1; childIndex <= quantity; childIndex++) {
        const existingEntry = existing.find((item) => Number(item?.childIndex) === childIndex);
        const childQrCodeValue = String(
            existingEntry?.childQrCodeValue
            || existingEntry?.value
            || `${ticketId}#${childIndex}`
        );

        await Ticket.upsertChildTicketQR({
            parentTicketId: ticketId,
            childIndex,
            childQrCodeValue,
            event: ticket.event,
            merchant: ticket.merchant,
            externalMerchantId: ticket.externalMerchantId
        });

        childQRCodes.push({
            childIndex,
            childQrCodeValue,
            parentTicketId: String(ticketId),
            eventId: String(metadata?.eventId || event?._id || event?.id || ''),
            merchantId: String(metadata?.merchantId || ''),
            externalMerchantId: String(metadata?.externalMerchantId || ''),
            active: existingEntry?.active !== false,
            isRead: existingEntry?.isRead === true,
            createdAt: existingEntry?.createdAt || new Date().toISOString()
        });
    }

    const updatedTicketInfo = {
        ...ticketInfoData,
        quantity: String(quantity),
        childQRCodes
    };
    await Ticket.updateTicketById(ticketId, { ticketInfo: updatedTicketInfo });

    return { childQRCodes, ticketInfo: updatedTicketInfo };
};

const qrCodeToDataUrl = (qrCode) => {
    if (!qrCode) return null;
    if (Buffer.isBuffer(qrCode)) {
        const asString = qrCode.toString('utf8');
        if (asString.startsWith('data:image/')) return asString;
        return `data:image/png;base64,${qrCode.toString('base64')}`;
    }
    if (typeof qrCode === 'string') {
        if (qrCode.startsWith('data:image/')) return qrCode;
        return `data:image/png;base64,${qrCode}`;
    }
    return null;
};

/**
 * Generate and persist master QR + ICS on the ticket (idempotent).
 * Must run at fulfillment time so clients can download/display QR without waiting for email.
 */
export const ensureTicketQrAndIcs = async (event, ticket) => {
    const ticketId = ticket?.id || ticket?._id;
    if (!ticketId || !event) {
        throw new Error('ensureTicketQrAndIcs: missing ticket or event');
    }

    const hasQr = !!(qrCodeToDataUrl(ticket.qrCode));
    const hasIcs = ticket.ics && (
        Buffer.isBuffer(ticket.ics)
            ? ticket.ics.length > 0
            : typeof ticket.ics === 'string' && ticket.ics.length > 0
    );

    if (hasQr && hasIcs) {
        return ticket;
    }

    const updateObj = {};
    if (!hasIcs) {
        updateObj.ics = await generateICS(event, ticketId);
    }
    if (!hasQr) {
        updateObj.qrCode = await generateQRCode(String(ticketId));
    }

    const updated = await Ticket.updateTicketById(ticketId, updateObj);
    return updated || ticket;
};

/** Generate QR + ICS before returning ticket to checkout clients (download / success UI). */
export const prepareTicketForClientResponse = async (event, ticket) => {
    if (!event || !ticket) return ticket;
    try {
        const enriched = await ensureTicketQrAndIcs(event, ticket);
        const ticketId = enriched?._id || enriched?.id || ticket?._id || ticket?.id;
        if (!ticketId) return enriched || ticket;
        const fresh = await Ticket.getTicketById(ticketId, false);
        return fresh || enriched || ticket;
    } catch (err) {
        warn('[prepareTicketForClientResponse] Failed to ensure QR/ICS (non-blocking)', err?.message || err);
        return ticket;
    }
};

/**
 * @param {object} options
 * @param {string|null} [options.marketCountryCode] — ISO alpha-2; omit or null = platform default (e.g. webhooks)
 */
export const createEmailPayload = async (event, ticket, ticketFor, otp, locale = 'en-US', options = {}) => {
    try {
        ticket = await ensureTicketQrAndIcs(event, ticket);
        const ticketId = ticket.id || ticket._id;
        const qrData = qrCodeToDataUrl(ticket.qrCode);
        if (!qrData) {
            throw new Error(`Missing QR code for ticket ${ticketId}`);
        }
        const icsData = ticket.ics
            ? (Buffer.isBuffer(ticket.ics) ? ticket.ics.toString('utf8') : String(ticket.ics))
            : await generateICS(event, ticketId);

        // Extract event data
        const eventDate = event.eventDate;
        const eventTimezone = event.eventTimezone || 'Europe/Helsinki';
        const venue = event.venue || {};
        const venueInfo = event.venueInfo || {};
        const merchant = event.merchant || {};

        let ticketInfoData = ticketInfoToPlainObject(ticket.ticketInfo);
        if (!ticket.ticketInfo) {
            console.warn('[ticketMaster] ticket.ticketInfo is missing or undefined');
        }

        // Helper function to safely get values from objects
        const getValue = (obj, key, defaultValue = 0) => {
            if (!obj || typeof obj !== 'object') return defaultValue;
            if (obj instanceof Map) {
                const val = obj.get(key);
                return val !== undefined && val !== null ? val : defaultValue;
            }
            const val = obj[key];
            return val !== undefined && val !== null ? val : defaultValue;
        };

        // Format dates and times
        const formattedEventDate = formatEventDate(eventDate, eventTimezone);
        const formattedEventTime = formatEventTime(eventDate, eventTimezone);
        const doorsOpenTime = eventDate ? moment(eventDate).tz(eventTimezone).subtract(15, 'minutes').format('h:mm A') : '';

        const quantity = parseInt(getValue(ticketInfoData, 'quantity') || '1', 10) || 1;
        const provisioned = await provisionGroupChildQRCodes(ticket, event, quantity, {
            eventId: event?._id,
            merchantId: ticket.merchant?._id || ticket.merchant,
            externalMerchantId: ticket.externalMerchantId
        });
        ticketInfoData = provisioned?.ticketInfo ?? ticketInfoData;
        const pricing = resolveTicketEmailPricing({ ticketInfoData, event });
        const {
            quantity: resolvedQuantity,
            orderFee,
            entertainmentTax,
            serviceTax,
            vatRate,
            seatTickets,
            totalBasePrice,
            totalServiceFee,
            totalEntertainmentTaxAmount,
            totalServiceTaxAmount,
            totalVatAmount,
            orderFeeServiceTax,
            totalAmount,
            usedFallbackTotal
        } = pricing;

        if (usedFallbackTotal) {
            warn(
                '[createEmailPayload] missing authoritative paid total; using recomputed fallback. ticketId=%s eventId=%s email=%s',
                String(ticketId || ''),
                String(event?._id || ''),
                String(getValue(ticketInfoData, 'email', '') || '')
            );
        }

        // Get currency (stored value may be non-string; coerce before toUpperCase)
        const currency = String(
            getValue(ticketInfoData, 'currency', '') || process.env.PAYMENT_CURRENCY || 'EUR'
        ).toUpperCase();
        const currencySymbol = getCurrencySymbol(currency);
        const formatMoney = (amount) => `${formatCurrency(amount)} ${currencySymbol}`;
        const formatFinalMoney = (amount) => `${formatFinalCurrency(amount)} ${currencySymbol}`;

        // Extract venue information
        const venueName = venue.name || venueInfo.name || event.eventLocationAddress || 'TBA';
        const venueAddress = venue.address || event.eventLocationAddress || '';
        const geoCode = event.eventLocationGeoCode || venue.geoCode || null;
        const venueMapLink = buildVenueMapLink(venue, geoCode);

        // Extract organizer information (from merchant or venueInfo)
        const organizerName = merchant.orgName || merchant.name || venueInfo.name || 'Event Organizer';
        const organizerEmail = merchant.companyEmail || merchant.email || process.env.EMAIL_USERNAME || 'info@finnep.fi';
        const organizerPhone = merchant.companyPhoneNumber || merchant.phone || '';

        // Extract attendee name - ticketFor might be email hash, so prioritize ticketInfo fields
        const attendeeName = getValue(ticketInfoData, 'fullName') ||
                            getValue(ticketInfoData, 'attendeeName') ||
                            'there';

        // Extract ticket information - check ticketInfoData, also check event.ticketInfo
        // If seatTickets array exists, build ticketName from seat ticket names
        // (seatTickets already extracted earlier for price calculation)

        let ticketName;

        if (seatTickets && Array.isArray(seatTickets) && seatTickets.length > 0) {
            // Build ticket name from seat tickets: "Section C, Row 1, Seat 21, Section C, Row 1, Seat 20"
            const seatTicketNames = seatTickets
                .map(seatTicket => {
                    // Handle both Map and plain object formats
                    if (seatTicket instanceof Map) {
                        return seatTicket.get('ticketName') || null;
                    } else if (typeof seatTicket === 'object' && seatTicket !== null) {
                        return seatTicket.ticketName || null;
                    }
                    return null;
                })
                .filter(Boolean); // Remove null/undefined values

            if (seatTicketNames.length > 0) {
                ticketName = seatTicketNames.join(', ');
            } else {
                // Fallback if no ticketName in seatTickets
                ticketName = `${seatTickets.length} Seat(s)`;
            }
        } else {
            // No seatTickets, use standard ticket name extraction
            ticketName = getValue(ticketInfoData, 'ticketName') ||
                       getValue(ticketInfoData, 'name') ||
                       ticket.type ||
                       'General Admission';

            // If ticketName is an ID, try to find the actual ticket name from event.ticketInfo
            if (ticketName && event.ticketInfo && Array.isArray(event.ticketInfo)) {
                const matchingTicket = event.ticketInfo.find(t =>
                    t._id?.toString() === ticketName ||
                    t.id?.toString() === ticketName ||
                    t.name === ticketName
                );
                if (matchingTicket) {
                    ticketName = matchingTicket.name || ticketName;
                }
            }
        }
        const purchaseDate = formatPurchaseDate(
            getValue(ticketInfoData, 'purchaseDate') ||
            (ticket.createdAt ? new Date(ticket.createdAt) : new Date())
        );

        const marketCountryCode =
            options && Object.prototype.hasOwnProperty.call(options, 'marketCountryCode')
                ? options.marketCountryCode
                : null;
        const useSiloEmail = options.channel === 'silo' && options.merchant;
        let companyName;
        let companyLogo;
        let brandingContactEmail;
        let businessId;
        let socialMedidFB;
        let socialMedidLN;

        if (useSiloEmail) {
            const siloBranding = resolveSiloEmailBranding(options.merchant);
            companyName = siloBranding.companyName;
            companyLogo = siloBranding.companyLogo;
            brandingContactEmail = siloBranding.brandingContactEmail;
            businessId = '';
            const merchantObj = options.merchant && typeof options.merchant.toObject === 'function'
                ? options.merchant.toObject()
                : (options.merchant || event.merchant || {});
            socialMedidFB = merchantObj?.socialMedia?.facebook || event.socialMedia?.facebook || '';
            socialMedidLN = merchantObj?.socialMedia?.linkedin || event.socialMedia?.linkedin || '';
        } else {
            const branding = await resolvePlatformBrandingAsync(marketCountryCode);
            companyName = branding.companyName;
            companyLogo = branding.companyLogo;
            brandingContactEmail = branding.brandingContactEmail;
            businessId = branding.businessId;
            socialMedidFB = branding.socialMedidFB || event.socialMedia?.facebook;
            socialMedidLN = branding.socialMedidLN || event.socialMedia?.linkedin;
        }

        // Public transport
        const publicTransportLink = event.transportLink || buildVenueMapLink(venue);
        const publicTransportInfo = event.transportLink ? 'Click the link above for directions' : (venue.transportInfo || 'Please check the venue website for transportation options');

        const discountDisplay = getTicketDiscountDisplay(ticketInfoData);
        const displayBasePriceTotal = discountDisplay
            ? discountDisplay.catalogTotalBasePrice
            : totalBasePrice;

        // Build template variables
        // Note: Template shows "(x3)" so we pass TOTAL values (per-unit * quantity)
        const templateVariables = {
            // Header & Branding
            companyLogo: companyLogo,
            eventPromotionalPhoto: event.eventPromotionPhoto || event.eventPromotionalPhoto || '',
            eventTitle: event.eventTitle || '',
            companyName: companyName,

            // Attendee & Ticket
            attendeeName: attendeeName,
            ticketCode: otp || '',

            // Event Details
            eventDate: formattedEventDate,
            eventTime: formattedEventTime,
            doorsOpenTime: doorsOpenTime,
            venueName: venueName,
            venueAddress: venueAddress,
            venueMapLink: venueMapLink,

            // Order & Pricing
            purchaseDate: purchaseDate,
            ticketName: ticketName,
            quantity: resolvedQuantity.toString(),
            // Total values for display with "(x3)" in template
            // basePrice and serviceFee are per-unit, so we multiply by quantity
            // serviceTaxAmount and vatAmount from DB are already totals (from frontend metadata)
            basePrice: formatMoney(displayBasePriceTotal),
            ticketPrice: formatMoney(displayBasePriceTotal), // Keep for backward compatibility
            subtotal: formatMoney(displayBasePriceTotal + totalEntertainmentTaxAmount),
            couponCode: discountDisplay?.couponCode || null,
            couponDiscountAmount: discountDisplay
                ? formatMoney(discountDisplay.couponDiscountAmount)
                : null,
            hasDiscount: !!discountDisplay,
            serviceFee: formatMoney(totalServiceFee),
            serviceTaxRate: serviceTax > 0 ? serviceTax.toString() : null,
            // serviceTaxAmount from DB is already total (perUnitServiceTax * quantity from frontend)
            serviceTaxAmount: totalServiceTaxAmount > 0 ? formatMoney(totalServiceTaxAmount) : null,
            entertainmentTaxRate: entertainmentTax > 0 ? entertainmentTax.toString() : null,
            // entertainmentTaxAmount is calculated from individual seat tickets or stored total
            entertainmentTaxAmount: totalEntertainmentTaxAmount > 0 ? formatMoney(totalEntertainmentTaxAmount) : null,
            vatRate: vatRate > 0 ? vatRate.toString() : null, // Use vatRate (not vat) - vatRate might be different from vat
            // vatAmount from DB is already total (perUnitVat * quantity from frontend)
            vatAmount: totalVatAmount > 0 ? formatMoney(totalVatAmount) : null,
            orderFee: orderFee > 0 ? formatMoney(orderFee) : null,
            orderFeeServiceTax: orderFeeServiceTax > 0 ? formatMoney(orderFeeServiceTax) : null,
            tax: formatMoney(totalEntertainmentTaxAmount + totalServiceTaxAmount), // Keep for backward compatibility
            totalAmount: formatFinalMoney(totalAmount),

            // Transportation
            publicTransportLink: publicTransportLink,
            publicTransportInfo: publicTransportInfo,

            // Organizer Contact
            organizerName: organizerName,
            organizerEmail: organizerEmail,
            organizerPhone: organizerPhone,

            // Platform & Footer
            brandingContactEmail,
            businessId: businessId,
            socialMedidFB: socialMedidFB,
            socialMedidLN: socialMedidLN
        };

        // Check if event has custom email template
        const emailTemplate = event?.otherInfo?.emailTemplate;
        let loadedData = null;

        if (emailTemplate) {
            // Use custom template with simple string replacement
            loadedData = emailTemplate
                .replace(/\$eventTitle/g, templateVariables.eventTitle)
                .replace(/\$eventPromotionalPhoto/g, templateVariables.eventPromotionalPhoto)
                .replace(/\$qrcodeData/g, 'cid:qrcode@ticket')
                .replace(/\$ticketCode/g, templateVariables.ticketCode);
        } else {
            // Use MJML template
            const fileLocation = path.join(__dirname, '..', 'emailTemplates', 'ticket_template.html');
            loadedData = await loadEmailTemplate(fileLocation, templateVariables, null, null, null, locale);
        }

        if (!loadedData || (typeof loadedData === 'string' && loadedData.trim().length === 0)) {
            // Fallback template to avoid blocking ticket delivery when template rendering fails silently.
            loadedData = `
                <html>
                  <body>
                    <h2>${templateVariables.eventTitle || 'Your Event Ticket'}</h2>
                    <p>Your ticket code: <strong>${templateVariables.ticketCode || ''}</strong></p>
                    <p>Please keep this email for event entry.</p>
                  </body>
                </html>
            `;
        }
        if (!ticketFor) {
            throw new Error('Ticket recipient is missing');
        }

        const toQrAttachment = (dataUrl, filename) => {
            const base64 = String(dataUrl || '').split('base64,')[1];
            if (!base64) {
                throw new Error(`Invalid QR data for attachment: ${filename}`);
            }
            return {
                filename,
                content: base64,
                encoding: 'base64',
            };
        };

        const childQREntriesRaw = getValue(ticketInfoData, 'childQRCodes', []);
        const childQREntries = Array.isArray(childQREntriesRaw)
            ? childQREntriesRaw
                .map((child, idx) => {
                    const childIndex = Number(child?.childIndex ?? (idx + 1));
                    const childQrCodeValue = String(child?.childQrCodeValue || child?.value || `${ticketId}#${childIndex}`);
                    return {
                        childIndex,
                        childQrCodeValue
                    };
                })
                .filter((child) => child.childQrCodeValue)
            : [];

        const shouldAttachChildQRCodes = quantity > 1 && childQREntries.length > 0;
        const attachments = [];

        if (shouldAttachChildQRCodes) {
            for (const child of childQREntries) {
                const childQrData = await generateQRCode(child.childQrCodeValue);
                attachments.push(
                    toQrAttachment(
                        childQrData,
                        `ticket-qrcode-guest-${child.childIndex}.png`
                    )
                );
            }
        } else {
            attachments.push(toQrAttachment(qrData, 'ticket-qrcode.png'));
        }

        const message = {
            to: ticketFor,
            subject: event.eventTitle,
            html: typeof loadedData === 'string' ? loadedData : loadedData.toString(),
            attachDataUrls: true,
            icalEvent: {
                filename: 'event-ticket.ics',
                method: 'request',
                content: icsData
            },
            attachments
        };
        if (!useSiloEmail) {
            message.from = process.env.EMAIL_USERNAME;
        } else {
            const siloBranding = resolveSiloEmailBranding(options.merchant);
            message.replyTo = siloBranding.replyTo || undefined;
        }
        return message;

    } catch (err) {
        error('error creating ticket email payload %s', err?.stack || err?.message || String(err));
        throw err;
    }
}

/**
 * Send ticket email without blocking the caller (e.g. checkout response).
 * Failed sends are persisted by sendMail.forward for scheduler retry.
 */
async function deliverTicketEmailPayload(ticketId, emailPayload, options = {}) {
    if (options.channel === 'silo' && options.merchant) {
        const { sendSiloEmail } = await import('./siloMail.js');
        await sendSiloEmail(options.merchant, emailPayload);
    } else {
        await forward(emailPayload);
    }
    if (ticketId) {
        await Ticket.updateTicketById(ticketId, { isSend: true });
    }
}

export const sendTicketEmailInBackground = (event, ticket, ticketForEmail, otp, locale = 'en-US', options = {}) => {
    const ticketId = ticket?._id || ticket?.id;
    void (async () => {
        try {
            if (!process.env.SEND_MAIL) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
            const emailPayload = await createEmailPayload(event, ticket, ticketForEmail, otp, locale, options);
            if (!emailPayload?.to) {
                error('[sendTicketEmailInBackground] missing recipient for ticket %s', ticketId);
                return;
            }
            await deliverTicketEmailPayload(ticketId, emailPayload, options);
        } catch (err) {
            error(
                '[sendTicketEmailInBackground] failed for ticket %s: %s',
                ticketId,
                err?.stack || err?.message || String(err)
            );
        }
    })();
};

export const queueTicketEmailDelivery = async (ticketId, emailPayload, options = {}) => {
    await deliverTicketEmailPayload(ticketId, emailPayload, options);
};

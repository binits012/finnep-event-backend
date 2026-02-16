import { generateICS,generateQRCode, loadEmailTemplate } from './common.js'
import * as Ticket from '../model/ticket.js'
import {error} from '../model/logger.js'
import dotenv from 'dotenv'
import moment from 'moment-timezone'
dotenv.config()
import { dirname } from 'path'
const __dirname = dirname(import.meta.url).slice(7)

/**
 * Format currency amount
 */
const formatCurrency = (amount, currency = 'EUR') => {
    if (amount === null || amount === undefined || isNaN(amount)) return '0.000';
    // Truncate to 3 decimal places without rounding (preserve exact values)
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount)) return '0.000';
    // Use round (not floor) to handle floating-point representation errors
    const rounded = Math.round(numAmount * 1000) / 1000;
    return rounded.toFixed(3);
};

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

export const createEmailPayload = async (event, ticket, ticketFor, otp, locale = 'en-US') => {
    try {
        const ticketId = ticket.id || ticket._id;
        const icsData = await generateICS(event, ticketId);
        const qrData = await generateQRCode(ticketId);
        const updateObj = {
            qrCode: qrData,
            ics: icsData
        };
        await Ticket.updateTicketById(ticketId, updateObj);

        // Extract event data
        const eventDate = event.eventDate;
        const eventTimezone = event.eventTimezone || 'Europe/Helsinki';
        const venue = event.venue || {};
        const venueInfo = event.venueInfo || {};
        const merchant = event.merchant || {};

        // ticket.ticketInfo is stored as a MongoDB Map, so we need to convert it to a plain object
        // Handle both Map and plain object cases
        let ticketInfoData = {};
        if (ticket.ticketInfo) {
            if (ticket.ticketInfo instanceof Map) {
                // Convert Map to plain object
                ticketInfoData = Object.fromEntries(ticket.ticketInfo);
                console.log('[ticketMaster] Converted Map to object:', ticketInfoData);
            } else if (typeof ticket.ticketInfo === 'object' && ticket.ticketInfo !== null) {
                // Already a plain object
                ticketInfoData = ticket.ticketInfo;
                console.log('[ticketMaster] Using plain object:', ticketInfoData);
            }
        } else {
            console.warn('[ticketMaster] ticket.ticketInfo is missing or undefined');
            console.log('[ticketMaster] ticket object keys:', Object.keys(ticket));
            console.log('[ticketMaster] ticket.ticketInfo type:', typeof ticket.ticketInfo);
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

        // Extract pricing information from ticketInfoData (the converted Map)
        // Use stored calculated values from DB, fallback to calculation if not available
        // NOTE: basePrice and serviceFee are stored as PER-UNIT values
        //       serviceTaxAmount and vatAmount are stored as TOTAL values (already multiplied by quantity)
        const basePrice = parseFloat(getValue(ticketInfoData, 'basePrice')) ||
                         parseFloat(getValue(ticketInfoData, 'price')) || 0;
        const serviceFee = parseFloat(getValue(ticketInfoData, 'serviceFee')) || 0;
        let orderFee = parseFloat(getValue(ticketInfoData, 'orderFee')) || 0;
        let entertainmentTax = parseFloat(getValue(ticketInfoData, 'entertainmentTax')) || 0;
        let serviceTax = parseFloat(getValue(ticketInfoData, 'serviceTax')) || 0;
        const vat = parseFloat(getValue(ticketInfoData, 'vat')) || 0;
        let vatRate = parseFloat(getValue(ticketInfoData, 'vatRate')) || vat; // Use let to allow recalculation if vatAmount exists but vatRate is 0

        // Get quantity (number of tickets) - needed to determine if stored values are per-unit or total
        const quantity = parseInt(getValue(ticketInfoData, 'quantity') || '1', 10) || 1;

        // Check if we have seatTickets (for seated events with different ticket types per seat)
        let seatTickets = getValue(ticketInfoData, 'seatTickets');
        if (typeof seatTickets === 'string') {
            try {
                seatTickets = JSON.parse(seatTickets);
            } catch (e) {
                seatTickets = null;
            }
        }
        const hasSeatTickets = seatTickets && Array.isArray(seatTickets) && seatTickets.length > 0;

        let totalBasePrice, totalServiceFee, totalEntertainmentTaxAmount, totalServiceTaxAmount, totalVatAmount;

        if (hasSeatTickets && event && event.ticketInfo) {
            // Check if we have pre-calculated totals stored (prefer stored values to avoid rounding)
            const storedTotalBasePrice = getValue(ticketInfoData, 'totalBasePrice');
            const storedTotalServiceFee = getValue(ticketInfoData, 'totalServiceFee');
            const storedEntertainmentTaxAmount = getValue(ticketInfoData, 'entertainmentTaxAmount');
            const storedServiceTaxAmount = getValue(ticketInfoData, 'serviceTaxAmount');
            const storedVatAmount = getValue(ticketInfoData, 'vatAmount');

            let hasStoredValues = false;

            // Use stored totals if available (preserve exact decimal values)
            if (storedTotalBasePrice !== null && storedTotalBasePrice !== undefined && storedTotalBasePrice !== '') {
                const parsed = parseFloat(storedTotalBasePrice);
                if (!isNaN(parsed)) {
                    totalBasePrice = parsed;
                    hasStoredValues = true;
                }
            }
            if (storedTotalServiceFee !== null && storedTotalServiceFee !== undefined && storedTotalServiceFee !== '') {
                const parsed = parseFloat(storedTotalServiceFee);
                if (!isNaN(parsed)) {
                    totalServiceFee = parsed;
                    hasStoredValues = true;
                }
            }
            if (storedEntertainmentTaxAmount !== null && storedEntertainmentTaxAmount !== undefined && storedEntertainmentTaxAmount !== '') {
                const parsed = parseFloat(storedEntertainmentTaxAmount);
                if (!isNaN(parsed)) {
                    totalEntertainmentTaxAmount = parsed;
                    hasStoredValues = true;
                }
            }
            if (storedServiceTaxAmount !== null && storedServiceTaxAmount !== undefined && storedServiceTaxAmount !== '') {
                const parsed = parseFloat(storedServiceTaxAmount);
                if (!isNaN(parsed)) {
                    totalServiceTaxAmount = parsed;
                    hasStoredValues = true;
                }
            }
            if (storedVatAmount !== null && storedVatAmount !== undefined && storedVatAmount !== '') {
                const parsed = parseFloat(storedVatAmount);
                if (!isNaN(parsed)) {
                    totalVatAmount = parsed;
                    hasStoredValues = true;
                }
            }

            // Only recalculate if stored values are not available
            if (!hasStoredValues) {
                // Calculate from individual seat tickets (for seated events with different ticket types)
                totalBasePrice = 0;
                totalServiceFee = 0;
                totalEntertainmentTaxAmount = 0;
                totalServiceTaxAmount = 0;
                totalVatAmount = 0;

                // Track entertainmentTax and serviceTax rates from first seat for display
                let firstSeatEntertainmentTax = entertainmentTax;
                let firstSeatServiceTax = serviceTax;

                seatTickets.forEach((seatTicket, index) => {
                    const seatTicketId = seatTicket.ticketId;
                    if (!seatTicketId) return;

                    const seatTicketConfig = event.ticketInfo.find(t => t._id?.toString() === seatTicketId.toString());
                    if (!seatTicketConfig) return;

                    const seatBasePrice = parseFloat(seatTicketConfig.price) || 0;
                    const seatServiceFee = parseFloat(seatTicketConfig.serviceFee) || 0;
                    const seatEntertainmentTax = parseFloat(seatTicketConfig.entertainmentTax) || 0;
                    const seatServiceTax = parseFloat(seatTicketConfig.serviceTax) || 0;
                    const seatVatRate = parseFloat(seatTicketConfig.vatRate) || vatRate || 0;

                    // Use first seat's rates for display
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

                // Update rates for display (use first seat's rates)
                entertainmentTax = firstSeatEntertainmentTax;
                serviceTax = firstSeatServiceTax;
            } else {
                // Use rates from stored data or first seat ticket for display
                const firstSeatTicketId = seatTickets[0]?.ticketId;
                if (firstSeatTicketId) {
                    const firstSeatTicketConfig = event.ticketInfo.find(t => t._id?.toString() === firstSeatTicketId.toString());
                    if (firstSeatTicketConfig) {
                        entertainmentTax = parseFloat(firstSeatTicketConfig.entertainmentTax) || entertainmentTax;
                        serviceTax = parseFloat(firstSeatTicketConfig.serviceTax) || serviceTax;
                    }
                }
            }

            // Use stored orderFee if available
            if (orderFee === 0) {
                const firstSeatTicketId = seatTickets[0]?.ticketId;
                if (firstSeatTicketId) {
                    const firstSeatTicketConfig = event.ticketInfo.find(t => t._id?.toString() === firstSeatTicketId.toString());
                    if (firstSeatTicketConfig) {
                        orderFee = parseFloat(firstSeatTicketConfig.orderFee) || 0;
                    }
                }
            }
        } else {
            // Check if we have pre-calculated totals stored (for both pricing_configuration and ticket_info)
            const storedTotalBasePrice = getValue(ticketInfoData, 'totalBasePrice');
            const storedTotalServiceFee = getValue(ticketInfoData, 'totalServiceFee');

            // Use stored totals if available (pre-calculated from frontend)
            // Check for null/undefined, but allow 0 as a valid value
            if (storedTotalBasePrice !== null && storedTotalBasePrice !== undefined && storedTotalBasePrice !== '') {
                const parsed = parseFloat(storedTotalBasePrice);
                if (!isNaN(parsed)) {
                    totalBasePrice = parsed;
                } else {
                    // Fallback: multiply per-unit by quantity
                    totalBasePrice = basePrice * quantity;
                }
            } else {
                // Fallback: multiply per-unit by quantity
                totalBasePrice = basePrice * quantity;
            }

            if (storedTotalServiceFee !== null && storedTotalServiceFee !== undefined && storedTotalServiceFee !== '') {
                const parsed = parseFloat(storedTotalServiceFee);
                if (!isNaN(parsed)) {
                    totalServiceFee = parsed;
                } else {
                    // Fallback: multiply per-unit by quantity
                    totalServiceFee = serviceFee * quantity;
                }
            } else {
                // Fallback: multiply per-unit by quantity
                totalServiceFee = serviceFee * quantity;
            }

            // Use stored calculated amounts from DB (already calculated and stored during ticket creation)
            // These are already totals (not per-unit)
            // Preserve exact decimal values without rounding
            const storedEntertainmentTaxAmount = getValue(ticketInfoData, 'entertainmentTaxAmount');
            if (storedEntertainmentTaxAmount !== null && storedEntertainmentTaxAmount !== undefined && storedEntertainmentTaxAmount !== '') {
                const parsed = parseFloat(storedEntertainmentTaxAmount);
                if (!isNaN(parsed)) {
                    totalEntertainmentTaxAmount = parsed; // Use stored value as-is, preserve all decimals
                } else {
                    totalEntertainmentTaxAmount = ((basePrice * entertainmentTax) / 100) * quantity;
                }
            } else {
                totalEntertainmentTaxAmount = ((basePrice * entertainmentTax) / 100) * quantity;
            }

            const storedServiceTaxAmount = getValue(ticketInfoData, 'serviceTaxAmount');
            if (storedServiceTaxAmount !== null && storedServiceTaxAmount !== undefined && storedServiceTaxAmount !== '') {
                const parsed = parseFloat(storedServiceTaxAmount);
                if (!isNaN(parsed)) {
                    totalServiceTaxAmount = parsed; // Use stored value as-is, preserve all decimals
                } else {
                    totalServiceTaxAmount = ((serviceFee * serviceTax) / 100) * quantity;
                }
            } else {
                totalServiceTaxAmount = ((serviceFee * serviceTax) / 100) * quantity;
            }

            const storedVatAmount = getValue(ticketInfoData, 'vatAmount');
            if (storedVatAmount !== null && storedVatAmount !== undefined && storedVatAmount !== '') {
                const parsed = parseFloat(storedVatAmount);
                if (!isNaN(parsed)) {
                    totalVatAmount = parsed; // Use stored value as-is, preserve all decimals
                } else {
                    totalVatAmount = ((basePrice * vatRate) / 100) * quantity;
                }
            } else {
                totalVatAmount = ((basePrice * vatRate) / 100) * quantity;
            }

            // For pricing_configuration, VAT = entertainmentTax (both are tax on base price)
            // If vatAmount is not set but entertainmentTaxAmount is, use entertainmentTaxAmount as vatAmount
            if (totalVatAmount === 0 && totalEntertainmentTaxAmount > 0) {
                totalVatAmount = totalEntertainmentTaxAmount;
                if (vatRate === 0 && entertainmentTax > 0) {
                    vatRate = entertainmentTax;
                }
            }

            // If we have vatAmount but vatRate is 0, try to calculate vatRate from vatAmount
            if (totalVatAmount > 0 && (vatRate === 0 || !vatRate) && totalBasePrice > 0) {
                const calculatedVatRate = (totalVatAmount / totalBasePrice) * 100;
                if (calculatedVatRate > 0 && !isNaN(calculatedVatRate)) {
                    vatRate = calculatedVatRate;
                }
            }
        }

        const storedOrderFeeServiceTax = getValue(ticketInfoData, 'orderFeeServiceTax');
        const orderFeeServiceTax = storedOrderFeeServiceTax !== 0 && storedOrderFeeServiceTax !== null && storedOrderFeeServiceTax !== undefined
            ? parseFloat(storedOrderFeeServiceTax)
            : (orderFee * serviceTax) / 100;

        // Order fee and its service tax are per transaction (not multiplied by quantity)
        // Total = (per-unit totals) + (per-transaction fees)
        const totalAmount = totalBasePrice + totalServiceFee + totalServiceTaxAmount + totalVatAmount + orderFee + orderFeeServiceTax;

        // Get currency
        const currency = getValue(ticketInfoData, 'currency')?.toUpperCase() || process.env.PAYMENT_CURRENCY?.toUpperCase() || 'EUR';
        const currencySymbol = getCurrencySymbol(currency);

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

        // Platform/Company information
        const companyName = process.env.COMPANY_TITLE || 'Finnep';
        const companyLogo = process.env.COMPANY_LOGO || 'https://finnep.s3.eu-central-1.amazonaws.com/Other/finnep_logo.png';
        const platformMailTo = process.env.PLATFORM_EMAIL || process.env.EMAIL_USERNAME || 'info@finnep.fi';
        const businessId = process.env.BUSINESS_ID || '3579764-6';
        const socialMedidFB = process.env.SOCIAL_MEDIA_FB || event.socialMedia?.facebook || 'https://www.facebook.com/profile.php?id=61565375592900';
        const socialMedidLN = process.env.SOCIAL_MEDIA_LN || event.socialMedia?.linkedin || 'https://www.linkedin.com/company/105069196/admin/dashboard/';

        // Public transport
        const publicTransportLink = event.transportLink || buildVenueMapLink(venue);
        const publicTransportInfo = event.transportLink ? 'Click the link above for directions' : (venue.transportInfo || 'Please check the venue website for transportation options');

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
            quantity: quantity.toString(),
            // Total values for display with "(x3)" in template
            // basePrice and serviceFee are per-unit, so we multiply by quantity
            // serviceTaxAmount and vatAmount from DB are already totals (from frontend metadata)
            basePrice: `${currencySymbol}${formatCurrency(totalBasePrice)}`,
            ticketPrice: `${currencySymbol}${formatCurrency(totalBasePrice)}`, // Keep for backward compatibility
            subtotal: `${currencySymbol}${formatCurrency(totalBasePrice + totalEntertainmentTaxAmount)}`,
            serviceFee: `${currencySymbol}${formatCurrency(totalServiceFee)}`,
            serviceTaxRate: serviceTax > 0 ? serviceTax.toString() : null,
            // serviceTaxAmount from DB is already total (perUnitServiceTax * quantity from frontend)
            serviceTaxAmount: totalServiceTaxAmount > 0 ? `${currencySymbol}${formatCurrency(totalServiceTaxAmount)}` : null,
            entertainmentTaxRate: entertainmentTax > 0 ? entertainmentTax.toString() : null,
            // entertainmentTaxAmount is calculated from individual seat tickets or stored total
            entertainmentTaxAmount: totalEntertainmentTaxAmount > 0 ? `${currencySymbol}${formatCurrency(totalEntertainmentTaxAmount)}` : null,
            vatRate: vatRate > 0 ? vatRate.toString() : null, // Use vatRate (not vat) - vatRate might be different from vat
            // vatAmount from DB is already total (perUnitVat * quantity from frontend)
            vatAmount: totalVatAmount > 0 ? `${currencySymbol}${formatCurrency(totalVatAmount)}` : null,
            orderFee: orderFee > 0 ? `${currencySymbol}${formatCurrency(orderFee)}` : null,
            orderFeeServiceTax: orderFeeServiceTax > 0 ? `${currencySymbol}${formatCurrency(orderFeeServiceTax)}` : null,
            tax: `${currencySymbol}${formatCurrency(totalEntertainmentTaxAmount + totalServiceTaxAmount)}`, // Keep for backward compatibility
            totalAmount: `${currencySymbol}${formatCurrency(totalAmount)}`,

            // Transportation
            publicTransportLink: publicTransportLink,
            publicTransportInfo: publicTransportInfo,

            // Organizer Contact
            organizerName: organizerName,
            organizerEmail: organizerEmail,
            organizerPhone: organizerPhone,

            // Platform & Footer
            platformMailTo: platformMailTo,
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
            const fileLocation = __dirname.replace('util', '') + '/emailTemplates/ticket_template.html';
            loadedData = await loadEmailTemplate(fileLocation, templateVariables, null, null, null, locale);
        }

        const qrBase64 = qrData.split(',')[1]; // Remove the data URI prefix
        const message = {
            from: process.env.EMAIL_USERNAME,
            to: ticketFor,
            subject: event.eventTitle,
            html: loadedData.toString(),
            attachDataUrls: true,
            icalEvent: {
                filename: 'event-ticket.ics',
                method: 'request',
                content: icsData
            },
            attachments: [
                {
                    filename: 'ticket-qrcode.png',
                    content: qrBase64,
                    encoding: 'base64',
                }
            ]
        };
        return message;

    } catch (err) {
        error('error creating ticket email payload %s', err);
        return err;
    }
};

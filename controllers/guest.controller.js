import * as consts from '../const.js'
import * as Crypto from '../model/crypto.js'
import * as VerificationCode from '../model/verificationCode.js'
import * as Ticket from '../model/ticket.js'
import * as Event from '../model/event.js'
import * as jwtToken from '../util/jwtToken.js'
import * as sendMail from '../util/sendMail.js'
import * as common from '../util/common.js'
import { error } from '../model/logger.js'
import * as hash from '../util/createHash.js'
import { PlatformMarketingConsent } from '../model/mongoModel.js'

const RATE_LIMIT_CODES_PER_HOUR = 10;

// Generate 8-digit random code
const generateCode = () => {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

export const checkEmail = async (req, res, next) => {
    try {
        const { email } = req.body;

        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Valid email address is required'
            });
        }

        // Check if email exists in system
        const emailCrypto = await Crypto.getCryptoBySearchIndex(email, 'email');

        if (emailCrypto && emailCrypto.length > 0) {
            return res.status(consts.HTTP_STATUS_OK).json({
                success: true,
                exists: true,
                message: 'Email found in system'
            });
        } else {
            return res.status(consts.HTTP_STATUS_OK).json({
                success: true,
                exists: false,
                message: 'Email not found in system'
            });
        }
    } catch (err) {
        error('error checking email %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Error checking email'
        });
    }
}

export const sendVerificationCode = async (req, res, next) => {
    try {
        const { email } = req.body;

        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Valid email address is required'
            });
        }

        // Check if email exists
        const emailCrypto = await Crypto.getCryptoBySearchIndex(email, 'email');

        if (!emailCrypto || emailCrypto.length === 0) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Email not found in system'
            });
        }

        const emailCryptoId = emailCrypto[0]._id;

        // Rate limiting: Check recent codes (last hour)
        const recentCodeCount = await VerificationCode.countRecentCodesByEmailCryptoId(emailCryptoId, 1);
        if (recentCodeCount >= RATE_LIMIT_CODES_PER_HOUR) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Too many verification code requests. Please try again later.'
            });
        }

        // Generate 8-digit code
        const code = generateCode();
        const hashedCode = VerificationCode.hashCode(code);

        // Store verification code in Redis (with 5 minute TTL)
        await VerificationCode.createVerificationCode(emailCryptoId, hashedCode);

        // Increment rate limit counter
        await VerificationCode.incrementRateLimitCounter(emailCryptoId);

        // Extract locale from request
        const locale = common.extractLocaleFromRequest(req);

        // Load email template and send email with code
        const emailHtml = await common.loadVerificationCodeTemplate(code, locale);
        const { getEmailSubject } = await import('../util/emailTranslations.js');
        const emailSubject = await getEmailSubject('verification_code', locale, { companyName: process.env.COMPANY_TITLE || 'Finnep' });
        const emailPayload = {
            from: process.env.EMAIL_USERNAME,
            to: email,
            subject: emailSubject,
            html: emailHtml
        };

        try {
            await sendMail.forward(emailPayload);
        } catch (emailErr) {
            error('error sending verification code email %s', emailErr);
            // Don't fail the request if email fails - code is still created
        }

        return res.status(consts.HTTP_STATUS_OK).json({
            success: true,
            message: 'Verification code sent to your email'
        });
    } catch (err) {
        error('error sending verification code %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Error sending verification code'
        });
    }
}

export const verifyCode = async (req, res, next) => {
    try {
        const { email, code } = req.body;

        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Valid email address is required'
            });
        }

        if (!code || typeof code !== 'string' || code.length !== 8) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Valid 8-digit code is required'
            });
        }

        // Get email crypto ID
        const emailCrypto = await Crypto.getCryptoBySearchIndex(email, 'email');

        if (!emailCrypto || emailCrypto.length === 0) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Email not found in system'
            });
        }

        const emailCryptoId = emailCrypto[0]._id;

        // Find active verification code
        const verificationCode = await VerificationCode.findActiveCodeByEmailCryptoId(emailCryptoId);

        if (!verificationCode) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'No valid verification code found. Please request a new code.'
            });
        }

        // Verify code
        const isValid = VerificationCode.verifyCode(code, verificationCode.code);

        if (!isValid) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Invalid verification code'
            });
        }

        // Mark code as used (delete from Redis)
        await VerificationCode.markCodeAsUsed(emailCryptoId);

        // Generate guest JWT token
        jwtToken.generateGuestJWT(email, emailCryptoId, async (err, token) => {
            if (err || !token) {
                error('error generating guest token %s', err);
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    success: false,
                    message: 'Error generating access token'
                });
            }

            return res.status(consts.HTTP_STATUS_OK).json({
                success: true,
                token: token,
                expiresIn: 900 // 15 minutes in seconds
            });
        });
    } catch (err) {
        error('error verifying code %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Error verifying code'
        });
    }
}

export const getTickets = async (req, res, next) => {
    try {
        const token = req.headers.authorization;
        const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

        await jwtToken.verifyGuestJWT(token, async (err, data) => {
            if (err || data === null) {
                return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }

            try {
                const emailCryptoId = data.emailCryptoId;

                // Get all tickets for this email
                const userTickets = await Ticket.getTicketsByEmailCryptoId(emailCryptoId);

                if (userTickets.length === 0) {
                    const platformConsent = await PlatformMarketingConsent.getOrCreatePlatformConsent(emailCryptoId);
                    return res.status(consts.HTTP_STATUS_OK).json({
                        success: true,
                        data: [],
                        platformMarketingOptIn: platformConsent?.platformMarketingOptIn !== false
                    });
                }

                const platformConsent = await PlatformMarketingConsent.getOrCreatePlatformConsent(emailCryptoId);

                // Populate event information
                const ticketsWithEvents = await Promise.all(
                    userTickets.map(async (ticket) => {
                        const event = await Event.getEventById(ticket.event);
                        return {
                            ...ticket.toObject(),
                            event: event
                        };
                    })
                );

                // Filter by year
                const yearFiltered = ticketsWithEvents.filter(ticket => {
                    if (!ticket.event || !ticket.event.eventDate) return false;
                    const eventYear = new Date(ticket.event.eventDate).getFullYear();
                    return eventYear === year;
                });

                return res.status(consts.HTTP_STATUS_OK).json({
                    success: true,
                    data: yearFiltered.map(t => {
                        let ticketInfoPlain = null;
                        if (t.ticketInfo) {
                            if (t.ticketInfo instanceof Map) {
                                ticketInfoPlain = Object.fromEntries(t.ticketInfo.entries());
                            } else if (typeof t.ticketInfo === 'object') {
                                ticketInfoPlain = t.ticketInfo;
                            }
                        }

                        const paymentCurrency = process.env.PAYMENT_CURRENCY || null;
                        const derivedPurchaseDate =
                            ticketInfoPlain?.purchaseDate ||
                            (t.createdAt ? new Date(t.createdAt).toISOString() : null);

                        let seatTickets = null;
                        if (Array.isArray(ticketInfoPlain?.seatTickets)) {
                            seatTickets = ticketInfoPlain.seatTickets
                                .map(st => {
                                    const pricing = st?.pricing && typeof st.pricing === 'object' ? st.pricing : null;
                                    return {
                                        placeId: st?.placeId ?? null,
                                        ticketName: st?.ticketName ?? null,
                                        pricing: pricing ? {
                                            basePrice: pricing.basePrice ?? pricing.unitPrice ?? null,
                                            tax: pricing.tax ?? pricing.vat ?? null,
                                            serviceFee: pricing.serviceFee ?? null,
                                            serviceTax: pricing.serviceTax ?? null,
                                            orderFee: pricing.orderFee ?? null,
                                            currency: pricing.currency ?? null
                                        } : null
                                    };
                                })
                                .filter(x => x.ticketName || x.placeId || x.pricing);
                        }

                        const sanitizedTicketInfo = ticketInfoPlain ? {
                            ticketName: ticketInfoPlain.ticketName || t.type || ticketInfoPlain.ticketType || null,
                            quantity: ticketInfoPlain.quantity ?? ticketInfoPlain.qty ?? null,
                            // Base price should prefer pre-tax fields.
                            price: ticketInfoPlain.basePrice ??
                                ticketInfoPlain.totalBasePrice ??
                                ticketInfoPlain.perUnitSubtotal ??
                                ticketInfoPlain.price ??
                                ticketInfoPlain.unitPrice ??
                                ticketInfoPlain.totalPrice ??
                                null,
                            serviceFee: ticketInfoPlain.serviceFee ??
                                ticketInfoPlain.serviceFeeTotal ??
                                ticketInfoPlain.totalServiceFee ??
                                ticketInfoPlain.ticketServiceFee ??
                                null,
                            vatAmount: ticketInfoPlain.vatAmount ??
                                ticketInfoPlain.totalVatAmount ??
                                ticketInfoPlain.taxAmount ??
                                ticketInfoPlain.entertainmentTaxAmount ??
                                null,
                            vatRate: ticketInfoPlain.vatRate ??
                                ticketInfoPlain.entertainmentTax ??
                                ticketInfoPlain.tax ??
                                null,
                            totalAmount: ticketInfoPlain.totalAmount ??
                                ticketInfoPlain.total ??
                                ticketInfoPlain.amount ??
                                ticketInfoPlain.totalPrice ??
                                ticketInfoPlain.totalPaid ??
                                ticketInfoPlain.grandTotal ??
                                (ticketInfoPlain.price ?? ticketInfoPlain.basePrice ?? null),
                            pricingModel: ticketInfoPlain.pricingModel ??
                                t.event?.venue?.pricingModel ??
                                null,
                            currency: ticketInfoPlain.currency || paymentCurrency,
                            purchaseDate: derivedPurchaseDate,
                            childQRCodes: Array.isArray(ticketInfoPlain.childQRCodes) ? ticketInfoPlain.childQRCodes : [],
                            ...(seatTickets ? { seatTickets } : {})
                            // Exclude sensitive fields: paymentIntentId, email, merchantId, eventId, ticketId, eventName
                        } : null;

                        const resolvedEventEndDate = t.event?.eventEndDate || t.event?.event_end_date || t.event?.eventDate || null;

                        return {
                            _id: t._id,
                            event: {
                                _id: t.event?._id,
                                eventTitle: t.event?.eventTitle,
                                eventDate: t.event?.eventDate,
                                eventEndDate: resolvedEventEndDate,
                                eventLocationAddress: t.event?.eventLocationAddress,
                                active: t.event?.active,
                                otherInfo: t.event?.otherInfo
                            },
                            type: t.type,
                            otp: t.otp,
                            ticketInfo: sanitizedTicketInfo,
                            createdAt: t.createdAt,
                            active: t.active
                        };
                    }),
                    platformMarketingOptIn: platformConsent?.platformMarketingOptIn !== false
                });
            } catch (err) {
                error('error getting tickets %s', err.stack);
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    success: false,
                    message: 'Error retrieving tickets'
                });
            }
        });
    } catch (err) {
        error('error in getTickets %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Error retrieving tickets'
        });
    }
}

export const getTicketById = async (req, res, next) => {
    try {
        const token = req.headers.authorization;
        const ticketId = req.params.id;

        if (!ticketId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Ticket ID is required'
            });
        }

        await jwtToken.verifyGuestJWT(token, async (err, data) => {
            if (err || data === null) {
                return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }

            try {
                const emailCryptoId = data.emailCryptoId;

                // Get ticket by ID (without populating ticketFor to get the ObjectId directly)
                const ticket = await Ticket.getTicketById(ticketId, false);

                if (!ticket) {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        success: false,
                        message: 'Ticket not found'
                    });
                }

                // Verify ticket belongs to this email
                // ticketFor is an ObjectId, convert to string for comparison
                const ticketForId = ticket.ticketFor?.toString() || String(ticket.ticketFor);

                if (ticketForId !== emailCryptoId) {
                    error('Access denied: ticketForId=%s, emailCryptoId=%s', ticketForId, emailCryptoId);
                    return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                        success: false,
                        message: 'Access denied'
                    });
                }

                // Get event information
                // ticket.event is already populated, so use it directly
                const event = ticket.event;

                if (!event) {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        success: false,
                        message: 'Event not found'
                    });
                }

                // Always allow viewing ticket details from this endpoint.
                // End-date gating, if needed, should be applied only to explicit download actions.

                // Convert QR code and ICS buffers to base64 strings
                let qrCodeBase64 = null;
                let icsContent = null;

                if (ticket.qrCode) {
                    if (Buffer.isBuffer(ticket.qrCode)) {
                        // If it's a Buffer, convert to base64 and create data URI
                        qrCodeBase64 = `data:image/png;base64,${ticket.qrCode.toString('base64')}`;
                    } else if (typeof ticket.qrCode === 'string') {
                        // If it's already a data URI string, use it as-is
                        // If it's just base64 without prefix, add the prefix
                        if (ticket.qrCode.startsWith('data:image/png;base64,')) {
                            qrCodeBase64 = ticket.qrCode;
                        } else {
                            // Assume it's raw base64, add data URI prefix
                            qrCodeBase64 = `data:image/png;base64,${ticket.qrCode}`;
                        }
                    }
                }

                if (ticket.ics) {
                    if (Buffer.isBuffer(ticket.ics)) {
                        icsContent = ticket.ics.toString('utf8');
                    } else if (typeof ticket.ics === 'string') {
                        icsContent = ticket.ics;
                    }
                }

                // Sanitize ticketInfo - only include safe, display-related fields
                // `ticket.ticketInfo` is stored as a Mongoose Map, so normalize it to a plain object first.
                let ticketInfoPlain = null;
                if (ticket.ticketInfo) {
                    if (ticket.ticketInfo instanceof Map) {
                        ticketInfoPlain = Object.fromEntries(ticket.ticketInfo.entries());
                    } else if (typeof ticket.ticketInfo === 'object') {
                        ticketInfoPlain = ticket.ticketInfo;
                    }
                }

                const paymentCurrency = process.env.PAYMENT_CURRENCY || null;
                const derivedPurchaseDate =
                    ticketInfoPlain?.purchaseDate ||
                    (ticket.createdAt ? new Date(ticket.createdAt).toISOString() : null);

                // Seating: for seated events, `placeIds` may be stored directly or under `seats: [{ placeId }]`.
                let placeIds = [];
                if (Array.isArray(ticketInfoPlain?.placeIds)) {
                    placeIds = ticketInfoPlain.placeIds;
                } else if (Array.isArray(ticketInfoPlain?.seats)) {
                    placeIds = ticketInfoPlain.seats
                        .map(s => s?.placeId)
                        .filter(Boolean);
                }

                // Seat ticket breakdown (optional; used by the mobile UI).
                // Keep it display-focused: seat ticket name + pricing.
                let seatTickets = null;
                if (Array.isArray(ticketInfoPlain?.seatTickets)) {
                    seatTickets = ticketInfoPlain.seatTickets
                        .map(st => {
                            const pricing = st?.pricing && typeof st.pricing === 'object' ? st.pricing : null;
                            return {
                                placeId: st?.placeId ?? null,
                                ticketName: st?.ticketName ?? null,
                                pricing: pricing
                                    ? {
                                          basePrice: pricing.basePrice ?? pricing.unitPrice ?? null,
                                          tax: pricing.tax ?? pricing.vat ?? null,
                                          serviceFee: pricing.serviceFee ?? null,
                                          serviceTax: pricing.serviceTax ?? null,
                                          orderFee: pricing.orderFee ?? null,
                                          currency: pricing.currency ?? null
                                      }
                                    : null
                            };
                        })
                        .filter(x => x.ticketName || x.placeId || x.pricing);
                }

                const sanitizedTicketInfo = ticketInfoPlain ? {
                    // Prefer ticketInfo.ticketName; fall back to the ticket's `type` (often the display name).
                    ticketName: ticketInfoPlain.ticketName || ticket.type || ticketInfoPlain.ticketType || null,
                    quantity: ticketInfoPlain.quantity ?? ticketInfoPlain.qty ?? null,
                    // Some flows store `price`, others store `basePrice` / `totalBasePrice`.
                    // Keep it flexible so free/unseated/priced-seat events still show something.
                    // Base price should prefer pre-tax fields.
                    price: ticketInfoPlain.basePrice ??
                        ticketInfoPlain.totalBasePrice ??
                        ticketInfoPlain.perUnitSubtotal ??
                        ticketInfoPlain.price ??
                        ticketInfoPlain.unitPrice ??
                        ticketInfoPlain.totalPrice ??
                        null,
                    // Service + totals are optional; include them when available so clients can render a breakdown.
                    serviceFee: ticketInfoPlain.serviceFee ??
                        ticketInfoPlain.serviceFeeTotal ??
                        ticketInfoPlain.totalServiceFee ??
                        ticketInfoPlain.ticketServiceFee ??
                        null,
                    totalAmount: ticketInfoPlain.totalAmount ??
                        ticketInfoPlain.total ??
                        ticketInfoPlain.amount ??
                        ticketInfoPlain.totalPrice ??
                        ticketInfoPlain.totalPaid ??
                        ticketInfoPlain.grandTotal ??
                        // Last resort: if we don't have the grand total, show the best-available price.
                        (ticketInfoPlain.price ?? ticketInfoPlain.basePrice ?? null),
                    currency: ticketInfoPlain.currency || paymentCurrency,
                    purchaseDate: derivedPurchaseDate,
                    childQRCodes: Array.isArray(ticketInfoPlain.childQRCodes) ? ticketInfoPlain.childQRCodes : [],
                    ...(seatTickets ? { seatTickets } : {})
                    // Exclude sensitive fields: paymentIntentId, email, merchantId, eventId, ticketId, eventName
                } : null;

                const platformConsent = await PlatformMarketingConsent.getOrCreatePlatformConsent(emailCryptoId);

                return res.status(consts.HTTP_STATUS_OK).json({
                    success: true,
                    data: {
                        _id: ticket._id,
                        event: {
                            _id: event._id,
                            eventTitle: event.eventTitle,
                            eventDate: event.eventDate,
                            eventEndDate: event.eventEndDate || event.event_end_date || event.eventDate,
                            eventLocationAddress: event.eventLocationAddress,
                            active: event.active
                        },
                        type: ticket.type,
                        otp: ticket.otp,
                        ticketInfo: sanitizedTicketInfo, 
                        ...(placeIds && placeIds.length > 0 ? { placeIds } : {}),
                        qrCode: qrCodeBase64,
                        ics: icsContent,
                        createdAt: ticket.createdAt,
                        active: ticket.active
                    },
                    platformMarketingOptIn: platformConsent?.platformMarketingOptIn !== false
                });
            } catch (err) {
                error('error getting ticket by id %s', err.stack);
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    success: false,
                    message: 'Error retrieving ticket'
                });
            }
        });
    } catch (err) {
        error('error in getTicketById %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Error retrieving ticket'
        });
    }
}

export const updatePlatformMarketingConsent = async (req, res, next) => {
    try {
        const token = req.headers.authorization;
        const { platformMarketingOptIn } = req.body;

        if (typeof platformMarketingOptIn !== 'boolean') {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'platformMarketingOptIn (boolean) is required'
            });
        }

        await jwtToken.verifyGuestJWT(token, async (err, data) => {
            if (err || data === null) {
                return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }

            try {
                const emailCryptoId = data.emailCryptoId;
                if (!emailCryptoId) {
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        success: false,
                        message: 'Invalid token payload'
                    });
                }

                const consent = await PlatformMarketingConsent.updatePlatformConsent(emailCryptoId, platformMarketingOptIn);

                return res.status(consts.HTTP_STATUS_OK).json({
                    success: true,
                    platformMarketingOptIn: consent?.platformMarketingOptIn !== false
                });
            } catch (err) {
                error('error updating platform marketing consent %s', err.stack);
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    success: false,
                    message: 'Error updating consent'
                });
            }
        });
    } catch (err) {
        error('error in updatePlatformMarketingConsent %s', err.stack);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Error updating consent'
        });
    }
}


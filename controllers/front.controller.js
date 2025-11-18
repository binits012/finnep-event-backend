import * as consts from '../const.js'
import * as  Photo from '../model/photo.js'
import * as  Notification from '../model/notification.js'
import * as  Event from '../model/event.js'
import * as  Setting from '../model/setting.js'
import * as OrderTicket from '../model/orderTicket.js'
import * as hash from '../util/createHash.js'
import { error, info } from '../model/logger.js'
import * as Ticket from '../model/ticket.js'
import crypto from 'crypto'
import { RESOURCE_NOT_FOUND, INTERNAL_SERVER_ERROR } from '../applicationTexts.js'
import * as ticketMaster from '../util/ticketMaster.js'
import * as sendMail from '../util/sendMail.js'
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_KEY)
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET
import redisClient from '../model/redisConnect.js'
import * as commonUtil from '../util/common.js'
import * as Merchant from '../model/merchant.js'
import * as OutboxMessage from '../model/outboxMessage.js'
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js'
import { v4 as uuidv4 } from 'uuid'
import busboy from 'busboy'
import { SETTINGS_CACHE_KEY } from '../const.js'


export const getDataForFront = async (req, res, next) => {
    const photo = await Photo.listPhoto()
    const photosWithCloudFrontUrls = await Promise.all(photo.map(async el => {

        const cacheKey = `signedUrl:${el.id}`;
        const cached = await commonUtil.getCacheByKey(redisClient, cacheKey);

        if (cached && cached.url && cached.expiresAt > Date.now()) {
            el.photoLink = cached.url;
        } else {
            // Generate new signed URL
            const expiresInSeconds = 29 * 24 * 60 * 60; // e.g., 29 days

            const signedUrl = await commonUtil.getCloudFrontUrl(el.photoLink)
            const expiresAt = Date.now() + expiresInSeconds * 1000;

            // Store in cache
            await commonUtil.setCacheByKey(redisClient, cacheKey, { url: signedUrl, expiresAt });
            redisClient.expire(cacheKey, expiresInSeconds);

            el.photoLink = signedUrl
        }
        return el
    }));
    const notification = await Notification.getAllNotification()
    let event = await Event.getEventsWithTicketCounts()

    if (event) {
        event = event.filter(e => e.active)
    }
    // Check cache first, then fallback to getSetting()
    let setting = await commonUtil.getCacheByKey(redisClient, SETTINGS_CACHE_KEY)
    if (!setting || setting instanceof Error || setting === null) {

        console.log('no setting in cache, getting from database');
        setting = await Setting.getSetting()
    }
    const data = {
        photo: photosWithCloudFrontUrls?.filter(e => e.publish),
        notification: notification,
        event: event,
        setting: setting
    }
    res.status(consts.HTTP_STATUS_OK).json(data)
}
export const getEventById = async (req, res, next) => {
    const id = req.params.id
    try {
        const event = await Event.getEventById(id)
        console.log(event)
        if (event) {
            const {  ...restOfEvent } = event?._doc

            const eventId = id
            // First ensure eventPhoto is a valid array with non-empty strings
            const validPhotos = restOfEvent?.eventPhoto?.filter(photo => photo && photo.trim() !== '') || [];
            /*
            const photoWithCloudFrontUrls = await Promise.all(validPhotos.map(async (photo, index) => {
                const cacheKey = `signedUrl:${eventId}:${index}`;
                const cached = await commonUtil.getCacheByKey(redisClient, cacheKey);
                if (cached && cached.url && cached.expiresAt > Date.now()) {
                    return cached.url;
                } else {
                    // Generate new signed URL
                    const expiresInSeconds = 29 * 24 * 60 * 60; // e.g., 29 days

                    const signedUrl = await commonUtil.getCloudFrontUrl(photo)
                    const expiresAt = Date.now() + expiresInSeconds * 1000;

                    // Store in cache
                    await commonUtil.setCacheByKey(redisClient, cacheKey, { url: signedUrl, expiresAt });
                    redisClient.expire(cacheKey, expiresInSeconds);

                    return signedUrl
                }
            }));
            */

            const data = {
                event: restOfEvent,
            }
           // data.event.eventPhoto = validPhotos


            return res.status(consts.HTTP_STATUS_OK).json(data)
        } else {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).send({ error: RESOURCE_NOT_FOUND });
        }

    } catch (err) {
        error(err)
        if (!res.headersSent) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR });
        }
    }

}
const createTicketOrder = async (otp, obj) => {
    return await OrderTicket.createOrderTicket(otp, obj)
}

export const createCheckoutSession = async (req, res, next) => {

    const eventName = req.body.eventName
    const eventId = req.body.eventId
    const price = req.body.price
    const quantity = req.body.quantity
    const ticketType = req.body.ticketType
    const totalPrice = req.body.totalPrice
    const email = req.body.email

    //let's do the sanity first, as we can't blindly trust the calculation done from the frontend
    const event = await Event.getEventById(eventId)

    if (!event) {
        error("fishy activity from " + email)
        res.status(consts.HTTP_STATUS_BAD_REQUEST).send({ error: "what are you tring to do? " });
    } else {
        //given event is found

        const eventPrice = event.ticketInfo.filter(e => ticketType === e.id).map(e => e.price)
        const totalPriceCalculation = eventPrice * quantity

        if (eventPrice !== price && totalPrice !== totalPriceCalculation) {
            error("fishy activity from " + email)
            res.status(consts.HTTP_STATUS_BAD_REQUEST).send({ error: "what are you tring to do? " });
        } else {
            const emailCrypto = await hash.getCryptoByEmail(email)
            let emailHash = null
            if (emailCrypto.length == 0) {
                //new email which is not yet in the system
                let tempEmailHash = await hash.createHashData(email, 'email')
                emailHash = tempEmailHash._id
            } else {
                emailHash = emailCrypto[0]._id
            }
            const tempTicketOrderObj = {
                eventName: eventName,
                eventId: eventId,
                price: price,
                quantity: quantity,
                ticketType: ticketType,
                totalPrice: totalPrice,
                email: emailHash
            }
            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let otp = '';
            for (let i = 0; i < 10; i++) {
                otp += characters.charAt(crypto.randomInt(0, characters.length));
            }
            const ticketOrder = await createTicketOrder(otp, tempTicketOrderObj)
            try {
                const session = await stripe.checkout.sessions.create({

                    payment_method_types: ['card'],
                    mode: 'payment',
                    line_items: [
                        {
                            price_data: {
                                currency: process.env.PAYMENT_CURRENCY,
                                product_data: {
                                    name: eventName,
                                    metadata: {
                                        eventId: eventId,
                                        url: `${req.headers.origin}/events/${eventId}`,
                                        ticketOrderId: ticketOrder.id
                                    }
                                },
                                unit_amount: price * 100, // amount in cents
                            },
                            quantity: quantity,
                        },
                    ],
                    customer_email: email, // Add customer_email parameter
                    success_url: `${req.headers.origin}/success?orderId=${ticketOrder.id}&otp=${otp}&session_id={CHECKOUT_SESSION_ID}`, // Redirect to success page
                    cancel_url: `${req.headers.origin}/cancel?orderId=${ticketOrder.id}&otp=${otp}&session_id={CHECKOUT_SESSION_ID}`,   // Redirect to cancel page
                    metadata: {
                        eventId: eventId,
                        url: `${req.headers.origin}/events/${eventId}`,
                        ticketOrderId: ticketOrder.id
                    }
                });

                res.json({ id: session.id });
            } catch (error) {
                if (!res.headersSent) {
                    res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: error.message });
                }

            }
        }
    }


}

export const completeOrderTicket = async (req, res, next) => {
    const orderId = req.body.orderId;
    const otp = req.body.otp;
    const sessionId = req.body.sessionId
    let ticketId = null;

    try {
        const orderTicket = await OrderTicket.getOrderTicketById(orderId);

        if (!orderTicket) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR });
        }


        // Check if status is already completed or max attempts reached
        if (orderTicket.status === 'completed' || orderTicket.attempts >= 1 || otp !== orderTicket.otp) {
            return res.status(consts.HTTP_STATUS_CONFLICT).send({ error: consts.HTTP_STATUS_CONFLICT });
        }

        // Use an atomic operation to update status and prevent race conditions
        const updateResult = await OrderTicket.updateOrderTicketById(orderId, {
            status: 'processing', // temporary status to avoid race conditions
            attempts: orderTicket.attempts + 1
        });

        if (!updateResult) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send({ error: INTERNAL_SERVER_ERROR });
        }

        const ticketInfo = Object.fromEntries(orderTicket.ticketInfo);
        const sessionDetails = await stripe.checkout.sessions.retrieve(sessionId)
        if ("paid" === sessionDetails.payment_status) {
            // Create the ticket
            const ticket = await Ticket.createTicket(null, ticketInfo.email, ticketInfo.eventId, ticketInfo?.ticketType,
                orderTicket?.ticketInfo, orderTicket?.otp).catch(err => {
                    error('error creating ticket', err.stack);
                    throw err;
                });

            ticketId = ticket.id;

            // Process email logic
            const emailCrypto = await hash.readHash(ticketInfo.email);
            const ticketFor = emailCrypto.data;
            const event = await Event.getEventById(ticketInfo.eventId);
            const emailPayload = await ticketMaster.createEmailPayload(event, ticket, ticketFor, orderTicket?.otp);
            await new Promise(resolve => setTimeout(resolve, 100)); // intentional delay
            await sendMail.forward(emailPayload).then(async data => {
                // Update the ticket to mark as sent
                const ticketData = await Ticket.updateTicketById(ticket.id, { isSend: true });

                // Mark orderTicket as completed
                await OrderTicket.updateOrderTicketById(orderId, {
                    status: 'completed',
                    attempts: orderTicket.attempts + 1,
                    updatedAt: Date.now(),
                    ticket: ticket.id
                });

                return res.status(consts.HTTP_STATUS_CREATED).json({ data: ticketData });

            }).catch(err => {
                error('error forwarding ticket %s', err);
                throw err;
            });
        }
    } catch (err) {
        console.log(err);
        if (!res.headersSent) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).send({ error: RESOURCE_NOT_FOUND });
        }
    }
}

export const cancelOrderTicket = async (req, res, next) => {
    const orderId = req.body.orderId
    const otp = req.body.otp
    const sessionId = req.body.sessionId
    const sessionDetails = await stripe.checkout.sessions.retrieve(sessionId)
    if (orderId && otp && sessionDetails) {
        //let's update the orderTicket status
        if (sessionDetails.payment_status === "unpaid") {
            //get the orderticket
            const orderTicket = await OrderTicket.getOrderTicketById(orderId);
            if (orderTicket && "created" === orderTicket.status && otp === orderTicket.otp) {
                //let's change the status of the ticket to in-complete
                await OrderTicket.updateOrderTicketById(orderId, {
                    status: 'in-complete',
                    attempts: orderTicket.attempts + 1,
                    updatedAt: Date.now()
                });
            }
        }
    }

    res.status(consts.HTTP_STATUS_NO_CONTENT).send()
}

export const listEvent = async (req, res, next) => {
    try {
        const q = req.query || {};
        const city = q.city;
        const country = q.country;
        const pageStr = q.page != null ? String(q.page) : '1';
        const limitStr = q.limit != null ? String(q.limit) : '1000';
        const pageNum = Math.max(parseInt(pageStr, 10) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limitStr, 10) || 1000, 1), 10000);

        // Delegate to model for filtered, paginated query
        const { items, total } = await Event.listEventFiltered({ city, country, page: pageNum, limit: limitNum });
        const totalPages = Math.max(Math.ceil(total / limitNum), 1);

        res.status(consts.HTTP_STATUS_OK).json({
            items,
            page: pageNum,
            limit: limitNum,
            total,
            totalPages,
        });
    } catch (err) {
        error(err);
        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: INTERNAL_SERVER_ERROR });
    }
}

// Request validation and security helpers
const getClientIdentifier = (req) => {
    return req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
};

const validateRequestSize = (reqBody) => {
    const bodyString = JSON.stringify(reqBody);
    const maxSize = 20 * 1024; // 20KB limit

    if (bodyString.length > maxSize) {
        throw new Error('Request payload too large');
    }

    return true;
};

const sanitizeString = (str, maxLength = 255) => {
    if (typeof str !== 'string') return '';
    return str.trim().substring(0, maxLength);
};

const sanitizeBoolean = (bool) => {
    if (typeof bool !== 'boolean') return false;
    return bool;
};

const validatePaymentRequest = (reqBody) => {
    const { amount, currency, metadata = {} } = reqBody;
    console.log('reqBody', reqBody);
    // Validate required fields
    if (!amount || !currency) {
        throw new Error('Missing required fields: amount and currency are required');
    }

    if (!metadata.eventId || !metadata.ticketId || !metadata.merchantId) {
        throw new Error('Missing required metadata: eventId, ticketId, and merchantId are required');
    }

    // Validate amount range (prevent extremely large amounts)
    if (amount <= 1 || amount > 10000000) { // Max 100,000.00 in cents
        throw new Error('Invalid amount range');
    }

    // Validate currency format
    if (!/^[a-z]{3}$/.test(currency)) {
        throw new Error('Invalid currency format');
    }

    // Validate and sanitize metadata fields
    const sanitizedMetadata = {
        eventId: sanitizeString(metadata.eventId, 50),
        ticketId: sanitizeString(metadata.ticketId, 50),
        merchantId: sanitizeString(metadata.merchantId, 50),
        externalMerchantId: sanitizeString(metadata.externalMerchantId, 50),
        email: sanitizeString(metadata.email, 100),
        quantity: sanitizeString(metadata.quantity, 10),
        eventName: sanitizeString(metadata.eventName, 200),
        ticketName: sanitizeString(metadata.ticketName, 100),
        country: sanitizeString(metadata.country, 50)
    };

    // Validate quantity
    if (sanitizedMetadata.quantity && (parseInt(sanitizedMetadata.quantity) < 1 || parseInt(sanitizedMetadata.quantity) > 100)) {
        throw new Error('Invalid quantity range');
    }

    // Validate email format
    if (sanitizedMetadata.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizedMetadata.email)) {
        throw new Error('Invalid email format');
    }

    // Validate ObjectId format for MongoDB IDs
    if (!/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.eventId)) {
        throw new Error('Invalid event ID format');
    }

    if (!/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.ticketId)) {
        throw new Error('Invalid ticket ID format');
    }

    if (!/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.merchantId)) {
        throw new Error('Invalid merchant ID format - must be numeric');
    }

    if (!/^\d+$/.test(sanitizedMetadata.externalMerchantId)) {
        throw new Error('Invalid merchant ID format - must be numeric');
    }

    return { amount, currency, metadata: sanitizedMetadata };
};

const validateMerchantAndEvent = async (metadata) => {
    // Check merchant - search by both merchantId and externalMerchantId
    console.log('metadata', metadata);
    const merchants = await Merchant.genericSearchMerchant(metadata.merchantId, metadata.externalMerchantId);
    const merchant = merchants.length > 0 ? merchants[0] : null;
    if (!merchant || merchant.status !== 'active') {
        throw new Error('Merchant is not available or active');
    }

    // Check event
    const event = await Event.getEventById(metadata.eventId);
    if (!event) {
        throw new Error('Event is not available');
    }

    // Check ticket configuration exists in event
    const ticketConfig = event.ticketInfo.find(ticket => ticket._id.toString() === metadata.ticketId);
    if (!ticketConfig) {
        throw new Error('Ticket configuration is not available in this event');
    }

    if(ticketConfig.status === 'sold_out') {
        throw new Error('Ticket is sold out');
    }

    return { merchant, event, ticket: ticketConfig };
};

const calculateExpectedPrice = (ticket, event, quantity) => {
    // Convert strings to numbers for calculations
    const ticketPrice = parseFloat(ticket.price) || 1;
    const serviceFee = parseFloat(ticket.serviceFee) || 1;
    const vatRate = parseFloat(ticket.vat) || 1;
    const qty = parseInt(quantity) || 1;

    // Calculate per unit subtotal (price + service fee)
    const perUnitSubtotal = ticketPrice + serviceFee;

    // Calculate VAT amount per unit
    const perUnitVat = perUnitSubtotal * (vatRate / 100);

    // Calculate total per unit
    const perUnitTotal = perUnitSubtotal + perUnitVat;

    // Calculate total for all units
    const totalAmount = perUnitTotal * qty;
    console.log('totalAmount', totalAmount);
    return {
        perUnitSubtotal,
        perUnitVat,
        perUnitTotal,
        totalAmount: Math.round(totalAmount * 100) / 100 // Round to 2 decimal places
    };
};

const validatePriceCalculation = (clientAmount, expectedPrice, tolerance = 0.01) => {
    const difference = Math.abs(clientAmount - expectedPrice.totalAmount);
    if (difference > tolerance) {
        throw new Error(`Price calculation mismatch. Expected: ${expectedPrice.totalAmount}, Received: ${clientAmount}`);
    }
};

/**
 * Calculate Stripe processing fee based on country and currency
 * Fetches fee structure from Settings (otherInfo.stripeFees) or uses defaults
 * @param {number} amount - Amount in cents
 * @param {string} currency - Currency code (e.g., 'eur', 'dkk', 'usd')
 * @param {string} country - Country name or code
 * @param {number} platformFee - Platform fee in cents
 * @returns {Promise<number>} Processing fee in cents
 */
const calculateStripeProcessingFee = async (amount, currency, country, platformFee = 30) => {
    const currencyLower = currency.toLowerCase();
    const countryLower = country?.toLowerCase() || '';
    // Default fee structure (fallback if not in database)
    const defaultFees = {
        // Default: 2.9% + $0.30 for USD or €0.25 for EUR, or generic estimate
        default: {
            percentage: 0.029,
            fixed: currencyLower === 'usd' ? 30 : currencyLower === 'eur' ? 25 : currencyLower === 'gbp' ? 25 : 30
        }
    };

    try {
        // Fetch Stripe fees from Settings - check cache first
        let settings = await commonUtil.getCacheByKey(redisClient, SETTINGS_CACHE_KEY)
        if (!settings || settings instanceof Error || settings === null) {
            settings = await Setting.getSetting()
        }
        console.log('settings', settings);
        const stripeFeesConfig = settings?.[0]?.otherInfo?.stripeFees;

        if (stripeFeesConfig && typeof stripeFeesConfig === 'object') {
            // Find matching country in config
            let feeStructure = defaultFees.default;

            // Try exact country match first
            if (stripeFeesConfig[countryLower]) {
                feeStructure = stripeFeesConfig[countryLower];
            } else {
                // Try partial match (e.g., "finland" in "Finland")
                for (const [configCountry, fees] of Object.entries(stripeFeesConfig)) {
                    if (countryLower.includes(configCountry.toLowerCase()) ||
                        configCountry.toLowerCase().includes(countryLower)) {
                        feeStructure = fees;
                        break;
                    }
                }

                // If still no match, check for currency-based default
                if (stripeFeesConfig[currencyLower]) {
                    feeStructure = stripeFeesConfig[currencyLower];
                } else if (stripeFeesConfig.default) {
                    feeStructure = stripeFeesConfig.default;
                }
            }

            // Calculate fee: percentage of amount + fixed fee
            const percentageFee = Math.ceil(amount * (feeStructure.percentage || 0));
            const fixedFee = feeStructure.fixed || 0;
            const totalFee = percentageFee + fixedFee + platformFee; // Add 10 cents to the stripe processing fee to cover the application fee
            console.log('totalFee', totalFee);
            return Math.max(platformFee, totalFee); // Minimum 5 cents
        }
    } catch (err) {
        error('Error fetching Stripe fees from Settings:', err);
    }

    // Fallback to default if Settings lookup fails
    const feeStructure = defaultFees.default;
    const percentageFee = Math.ceil(amount * feeStructure.percentage);
    const totalFee = percentageFee + feeStructure.fixed + platformFee;
    console.log('totalFee =============================================>', totalFee);
    return Math.max(5, totalFee); // Minimum 5 cents
};

export const createPaymentIntent = async (req, res, next) => {
    try {
        // Security Layer 1: Request size validation
        validateRequestSize(req.body);

        // Security Layer 2: Input validation and sanitization
        const { amount, currency, metadata } = validatePaymentRequest(req.body);

        // Security Layer 3: Business logic validation
        const { merchant, event, ticket } = await validateMerchantAndEvent(metadata);

        // Security Layer 4: Price validation
        const expectedPrice = calculateExpectedPrice(ticket, event, parseInt(metadata.quantity));
        validatePriceCalculation(amount / 100, expectedPrice);

        // Security Layer 5: Timeout protection for external API calls
        const stripeTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Stripe API timeout')), 10000); // 10 second timeout
        });

        const clientId = getClientIdentifier(req);

        // Debug: Log merchant data to see what stripeAccount contains
        console.log('Merchant data for Stripe Connect:', {
            merchantId: merchant._id,
            stripeAccount: merchant.stripeAccount,
            stripeAccountType: typeof merchant.stripeAccount,
            stripeAccountLength: merchant.stripeAccount?.length
        });

        // Validate stripeAccount format
        if (!merchant.stripeAccount) {
            throw new Error('Merchant does not have a Stripe account connected');
        }

        if (!merchant.stripeAccount.startsWith('acct_')) {
            throw new Error(`Invalid Stripe account format: ${merchant.stripeAccount}. Expected format: acct_xxxxxxxxxx`);
        }

        // Calculate fees
        const baseAmount = Math.round(amount);
        let stripePaymentIntentPayload;

        // Only apply connected account logic if merchant is NOT the platform account
        if(merchant.stripeAccount !== process.env.STRIPE_PLATFORM_ACCOUNT_ID) {

            // Calculate country-specific Stripe processing fee (fetched from Settings)
            const country = metadata.country || event?.country || '';
            const stripeProcessingFeeEstimate = await calculateStripeProcessingFee(
                baseAmount,
                currency,
                country,
                merchant?.otherInfo?.get("stripe") || 30
            );

            stripePaymentIntentPayload = {
                amount: baseAmount, // Customer pays base + application fee + Stripe fee
                currency: currency.toLowerCase(),
                metadata: {
                    ...metadata,
                    merchantId: metadata.merchantId,
                    externalMerchantId: metadata.externalMerchantId,
                    timestamp: new Date().toISOString(),
                    source: 'finnep-eventapp',
                    version: '1.0',
                    serverCalculatedTotal: expectedPrice.totalAmount.toString(),
                    clientId: clientId, // Track client for monitoring
                    baseAmount: baseAmount.toString(),
                    stripeProcessingFee: stripeProcessingFeeEstimate .toString()
                },

                automatic_payment_methods: {
                    enabled: true,
                },

                on_behalf_of: merchant.stripeAccount,
                transfer_data: {
                    destination: merchant.stripeAccount, // Connected account ID
                },
                application_fee_amount: stripeProcessingFeeEstimate

            };
        } else {
            // Platform account - no fees
            stripePaymentIntentPayload = {
                amount: baseAmount,
                currency: currency.toLowerCase(),
                metadata: {
                    ...metadata,
                    merchantId: metadata.merchantId,
                    externalMerchantId: metadata.externalMerchantId,
                    timestamp: new Date().toISOString(),
                    source: 'finnep-eventapp',
                    version: '1.0',
                    serverCalculatedTotal: expectedPrice.totalAmount.toString(),
                    clientId: clientId
                },
                automatic_payment_methods: {
                    enabled: true,
                }
            };
        }
        console.log('stripePaymentIntentPayload', stripePaymentIntentPayload, '\n', merchant.stripeAccount);
        const stripePromise = stripe.paymentIntents.create(
            stripePaymentIntentPayload 
        );
        // Race between Stripe API and timeout
        const paymentIntent = await Promise.race([stripePromise, stripeTimeout]);

        console.log('Payment Intent created:', {
            id: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            merchantId: metadata.merchantId,
            eventId: metadata.eventId,
            expectedPrice: expectedPrice.totalAmount,
            clientId: clientId
        });

        // Return client secret for frontend
        res.status(consts.HTTP_STATUS_OK).json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status
        });

    } catch (error) {
        console.error('Error creating payment intent:', {
            error: error.message,
            clientId: getClientIdentifier(req),
            timestamp: new Date().toISOString()
        });
        console.log('error', error.message);
        // Don't expose internal error details
        const safeErrorMessage =  error.message

        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            error: error.message
        });
    }
}

// Handle successful payment and create ticket records
export const handlePaymentSuccess = async (req, res, next) => {
    try {
        // Security Layer 1: Request size validation
        validateRequestSize(req.body);

        const { paymentIntentId, metadata } = req.body;

        // Security Layer 2: Validate required fields
        if (!paymentIntentId || !metadata) {
            throw new Error('Missing required fields');
        }

        // Security Layer 3: Validate payment intent ID format
        if (!/^pi_[a-zA-Z0-9_]+$/.test(paymentIntentId)) {
            throw new Error('Invalid payment intent ID format');
        }

        // Security Layer 4: Validate and sanitize metadata
        const sanitizedMetadata = {
            eventId: sanitizeString(metadata.eventId, 50),
            ticketId: sanitizeString(metadata.ticketId, 50),
            merchantId: sanitizeString(metadata.merchantId, 50),
            externalMerchantId: sanitizeString(metadata.externalMerchantId, 50),
            email: sanitizeString(metadata.email, 100),
            quantity: sanitizeString(metadata.quantity, 10),
            eventName: sanitizeString(metadata.eventName, 200),
            ticketName: sanitizeString(metadata.ticketName, 200),
            marketingOptIn: sanitizeBoolean(metadata?.marketingOptIn || false)
        };

        // Validate ID formats
        if (!/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.eventId) ||
            !/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.ticketId) ||
            !/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.merchantId) ) {
            throw new Error('Invalid MongoDB ObjectId format');
        }

        // Merchant ID is a numeric string (PostgreSQL style)
        if (!/^\d+$/.test(sanitizedMetadata.externalMerchantId)) {
            throw new Error('Invalid merchant ID format - must be numeric');
        }

        // Security Layer 5: Timeout for Stripe API call
        const stripeTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Stripe API timeout')), 10000);
        });

        const stripePromise = stripe.paymentIntents.retrieve(paymentIntentId);
        const paymentIntent = await Promise.race([stripePromise, stripeTimeout]);

        if (paymentIntent.status !== 'succeeded') {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Payment not successful'
            });
        }

        // Generate secure OTP using the existing createCode utility
        const otp = await commonUtil.createCode(8); // 8-character alphanumeric OTP

        // Create ticketInfo object similar to completeOrderTicket
        const ticketInfo = {
            eventName: sanitizedMetadata.eventName,
            ticketName: sanitizedMetadata.ticketName,
            quantity: sanitizedMetadata.quantity,
            price: paymentIntent.amount / 100, // Convert from cents
            currency: paymentIntent.currency,
            purchaseDate: new Date().toISOString(),
            paymentIntentId: paymentIntentId,
            email: sanitizedMetadata.email,
            merchantId: sanitizedMetadata.merchantId,
            eventId: sanitizedMetadata.eventId,
            ticketId: sanitizedMetadata.ticketId
        };

        // Get or create crypto hash for email (using efficient search)
        const emailCrypto = await hash.getCryptoBySearchIndex(sanitizedMetadata.email, 'email');
        let emailHash = null;
        if (emailCrypto.length == 0) {
            // New email which is not yet in the system
            let tempEmailHash = await hash.createHashData(sanitizedMetadata.email, 'email');
            emailHash = tempEmailHash._id;
        } else {
            emailHash = emailCrypto[0]._id;
        }
        const ticketFor = emailHash;
        // Create the ticket using the same pattern as completeOrderTicket
        let ticket = await Ticket.createTicket(
            null, // qrCode - will be generated later
            ticketFor,
            sanitizedMetadata.eventId, // event
            sanitizedMetadata.ticketName, // type
            ticketInfo, // ticketInfo
            otp, // otp
            sanitizedMetadata.merchantId,
            sanitizedMetadata.externalMerchantId
        ).catch(err => {
            console.error('Error creating ticket:', err);
            throw err;
        });

        // Generate email payload and send ticket (same as completeOrderTicket)
        const event = await Event.getEventById(sanitizedMetadata.eventId);
        const emailPayload = await ticketMaster.createEmailPayload(event, ticket, sanitizedMetadata.email, otp);
        await new Promise(resolve => setTimeout(resolve, 100)); // intentional delay
        await sendMail.forward(emailPayload).then(async data => {
            // Update the ticket to mark as sent
            ticket = await Ticket.updateTicketById(ticket._id, { isSend: true });
        }).catch(err => {
            console.error('Error sending ticket email:', err);
            // Don't throw here - ticket is created successfully even if email fails
        });

        // Update ticket availability (atomic operation)
        //await Ticket.decrementAvailability(sanitizedMetadata.ticketId, parseInt(sanitizedMetadata.quantity));

        const clientId = getClientIdentifier(req);
        console.log('Payment success handled:', {
            paymentIntentId,
            ticketId: ticket._id,
            eventId: sanitizedMetadata.eventId,
            clientId: clientId
        });


        res.status(consts.HTTP_STATUS_OK).json({
            success: true,
            data: ticket,
            message: "Payment processed successfully"
        });

        // Publish ticket creation event to notify other systems
        try {
            console.log('sanitizedMetadata', sanitizedMetadata, metadata);
            await publishTicketCreationEvent(ticket, event, sanitizedMetadata, paymentIntentId);
        } catch (publishError) {
            console.error('Failed to publish ticket creation event:', publishError);
            // Don't fail the entire operation if event publishing fails
        }

    } catch (error) {
        console.error('Error handling payment success:', {
            error: error.message,
            clientId: getClientIdentifier(req),
            timestamp: new Date().toISOString()
        });

        const safeErrorMessage = error.message.includes('timeout') ||
                                error.message.includes('Missing') ||
                                error.message.includes('Invalid') ||
                                error.message.includes('format') ||
                                error.message.includes('too large')
                                ? error.message
                                : 'Payment processing temporarily unavailable';

        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            error: safeErrorMessage
        });
    }
}

/**
 * Publishes ticket creation event to notify other systems
 * Uses the same pattern as merchant updates for consistency
 */
const publishTicketCreationEvent = async (ticket, event, metadata, paymentIntentId) => {
    try {
        // Generate unique identifiers for the event
        const correlationId = uuidv4();
        const messageId = uuidv4();

        // Get merchant information for the event
        const merchant = await Merchant.getMerchantByMerchantId(metadata.externalMerchantId);

        // Create a clean ticket object without heavy base64 data
        const cleanTicket = { ...ticket.toObject() };
        delete cleanTicket.qrCode; // Remove base64 QR code
        delete cleanTicket.ics;    // Remove base64 ICS file

        // Ensure ticketInfo is preserved and convert Map to Object if needed
        if (ticket.ticketInfo) {
            if (ticket.ticketInfo instanceof Map) {
                // Convert Map to plain object for JSON serialization
                cleanTicket.ticketInfo = Object.fromEntries(ticket.ticketInfo);
            } else if (!cleanTicket.ticketInfo) {
                cleanTicket.ticketInfo = ticket.ticketInfo;
            }
        }

        // Create comprehensive event data
        const eventData = {
            eventType: 'TicketCreated',
            aggregateId: ticket._id.toString(),
            data: {
                // Clean ticket object (without QR code and ICS)
                ticket: cleanTicket,
                marketingOptIn: metadata?.marketingOptIn || false,
                externalEventId: event.externalEventId,
                externalMerchantId: metadata.externalMerchantId,
                merchantId: metadata.merchantId,
                // Timestamps
                createdAt: new Date(),
                eventCreatedAt: event.createdAt
            },
            metadata: {
                correlationId: correlationId,
                causationId: messageId,
                timestamp: new Date().toISOString(),
                version: 1,
                source: 'finnep-eventapp',
            }
        };

        // Create outbox message entry
        const outboxMessageData = {
            messageId: messageId,
            exchange: 'event-merchant-exchange',
            routingKey: 'external.event.ticket.status.created',
            messageBody: eventData,
            headers: {
                'content-type': 'application/json',
                'message-type': 'TicketCreated',
                'correlation-id': correlationId,
                'event-version': '1.0'
            },
            correlationId: correlationId,
            eventType: 'TicketCreated',
            aggregateId: ticket._id.toString(),
            status: 'pending',
            exchangeType: 'topic',
            maxRetries: 3,
            attempts: 0
        };

        // Save outbox message for reliability
        const outboxMessage = await OutboxMessage.createOutboxMessage(outboxMessageData);
        info('Outbox message created for ticket creation: %s', outboxMessage._id);


        // Publish to RabbitMQ exchange
        await messageConsumer.publishToExchange(
            outboxMessageData.exchange,
            outboxMessageData.routingKey,
            outboxMessageData.messageBody,
            {
                exchangeType: 'topic',
                publishOptions: {
                    correlationId: outboxMessageData.correlationId,
                    contentType: 'application/json',
                    persistent: true,
                    headers: outboxMessageData.headers
                }
            }
        ).then(async () => {
            info('Ticket creation event published successfully: %s', outboxMessageData.messageId);

            // Mark outbox message as sent
            await OutboxMessage.markMessageAsSent(outboxMessage._id);

        }).catch(async (publishError) => {
            error('Error publishing ticket creation event:', publishError);

            // Mark outbox message as failed for retry
            await OutboxMessage.markMessageAsFailed(outboxMessage._id, publishError.message);
            throw publishError;
        });

        info('Published ticket creation event to exchange: %s', outboxMessageData.exchange);

    } catch (err) {
        error('Failed to publish ticket creation event:', err);
        throw err;
    }
};

// Send feedback handler
export const sendFeedback = async (req, res, next) => {
    try {
        const { firstName, lastName, email, subject, message } = req.body;

        // Validate required fields
        if (!firstName || !lastName || !email || !subject || !message) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'All fields are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Invalid email format'
            });
        }

        const fullName = `${firstName} ${lastName}`;

        // Load acknowledgement template
        const acknowledgementHtml = await commonUtil.loadFeedbackTemplate(fullName, email, subject, message);

        // Send acknowledgement email to sender
        const acknowledgementEmail = {
            from: process.env.EMAIL_USERNAME,
            to: email,
            subject: 'Thank you for your feedback - Finnep',
            html: acknowledgementHtml
        };

        await sendMail.forward(acknowledgementEmail);
        info('Feedback acknowledgement sent to:', email);

        // Forward feedback to info email
        const forwardEmail = {
            from: process.env.EMAIL_USERNAME,
            to: process.env.EMAIL_USERNAME, // info@finnep.fi
            subject: `New Feedback: ${subject}`,
            html: `
                <h2>New Feedback Received</h2>
                <p><strong>From:</strong> ${fullName} (${email})</p>
                <p><strong>Subject:</strong> ${subject}</p>
                <p><strong>Message:</strong></p>
                <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
                    ${message.replace(/\n/g, '<br>')}
                </div>
                <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
            `
        };

        await sendMail.forward(forwardEmail);
        info('Feedback forwarded to info email');

        res.status(consts.HTTP_STATUS_OK).json({
            success: true,
            message: 'Feedback sent successfully'
        });

    } catch (err) {
        error('Error sending feedback:', err);
        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Failed to send feedback. Please try again.'
        });
    }
};

// Send career application handler
export const sendCareerApplication = async (req, res, next) => {
    try {
        // Parse multipart form data using busboy
        const formData = {};
        let resumeFile = null;

        const bb = busboy({ headers: req.headers, limits: { fileSize: consts.MAX_FILE_SIZE } });

        return new Promise((resolve, reject) => {
            bb.on('field', (name, value) => {
                formData[name] = value;
            });

            bb.on('file', (name, file, info) => {
                if (name === 'resume') {
                    const { filename, mimeType } = info;

                    // Validate file type
                    if (!consts.ALLOWED_RESUME_TYPES.includes(mimeType)) {
                        file.resume();
                        return;
                    }

                    const chunks = [];
                    file.on('data', (chunk) => {
                        chunks.push(chunk);
                    });

                    file.on('end', () => {
                        resumeFile = {
                            filename: filename,
                            content: Buffer.concat(chunks),
                            mimeType: mimeType
                        };
                    });
                } else {
                    file.resume();
                }
            });

            bb.on('finish', async () => {
                try {
                    const { firstName, lastName, email, phone, position, experience, coverLetter, portfolio, linkedin, availability, salary, relocate, additionalInfo } = formData;

                    // Validate required fields
                    if (!firstName || !lastName || !email || !position) {
                        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                            success: false,
                            message: 'First name, last name, email, and position are required'
                        });
                    }

                    // Validate email format
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(email)) {
                        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                            success: false,
                            message: 'Invalid email format'
                        });
                    }

                    const fullName = `${firstName} ${lastName}`;

                    // Load acknowledgement template
                    const acknowledgementHtml = await commonUtil.loadCareerTemplate(fullName, email, phone, position, experience, availability);

                    // Send acknowledgement email to applicant
                    const acknowledgementEmail = {
                        from: process.env.EMAIL_USERNAME,
                        to: email,
                        subject: 'Thank you for your application - Finnep',
                        html: acknowledgementHtml
                    };

                    await sendMail.forward(acknowledgementEmail);
                    info('Career application acknowledgement sent to:', email);

                    // Prepare forward email with application details
                    let forwardHtml = `
                        <h2>New Career Application Received</h2>
                        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 10px 0;">
                            <h3>Applicant Information</h3>
                            <p><strong>Name:</strong> ${fullName}</p>
                            <p><strong>Email:</strong> ${email}</p>
                            <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
                            <p><strong>Position Applied For:</strong> ${position}</p>
                            <p><strong>Experience:</strong> ${experience || 'Not provided'}</p>
                            <p><strong>Availability:</strong> ${availability || 'Not specified'}</p>
                            <p><strong>Expected Salary:</strong> ${salary || 'Not specified'}</p>
                            <p><strong>Willing to Relocate:</strong> ${relocate || 'Not specified'}</p>
                        </div>
                    `;

                    if (coverLetter) {
                        forwardHtml += `
                            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 10px 0;">
                                <h3>Cover Letter</h3>
                                <div style="background-color: #ffffff; padding: 15px; border-radius: 5px; border-left: 4px solid #4f46e5;">
                                    ${coverLetter.replace(/\n/g, '<br>')}
                                </div>
                            </div>
                        `;
                    }

                    if (portfolio || linkedin) {
                        forwardHtml += `
                            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 10px 0;">
                                <h3>Portfolio & Links</h3>
                                ${portfolio ? `<p><strong>Portfolio:</strong> <a href="${portfolio}" target="_blank">${portfolio}</a></p>` : ''}
                                ${linkedin ? `<p><strong>LinkedIn:</strong> <a href="${linkedin}" target="_blank">${linkedin}</a></p>` : ''}
                            </div>
                        `;
                    }

                    if (additionalInfo) {
                        forwardHtml += `
                            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 10px 0;">
                                <h3>Additional Information</h3>
                                <div style="background-color: #ffffff; padding: 15px; border-radius: 5px;">
                                    ${additionalInfo.replace(/\n/g, '<br>')}
                                </div>
                            </div>
                        `;
                    }

                    forwardHtml += `<p><strong>Application Date:</strong> ${new Date().toLocaleString()}</p>`;

                    // Forward application to info email
                    const forwardEmail = {
                        from: process.env.EMAIL_USERNAME,
                        to: process.env.EMAIL_USERNAME, // info@finnep.fi
                        subject: `New Career Application: ${position} - ${fullName}`,
                        html: forwardHtml,
                        attachments: resumeFile ? [{
                            filename: resumeFile.filename,
                            content: resumeFile.content,
                            contentType: resumeFile.mimeType
                        }] : []
                    };

                    await sendMail.forward(forwardEmail);
                    info('Career application forwarded to info email');

                    res.status(consts.HTTP_STATUS_OK).json({
                        success: true,
                        message: 'Application submitted successfully'
                    });

                } catch (err) {
                    error('Error sending career application:', err);
                    res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        success: false,
                        message: 'Failed to submit application. Please try again.'
                    });
                }
            });

            bb.on('error', (err) => {
                error('Busboy error:', err);
                res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    success: false,
                    message: 'Error processing form data'
                });
            });

            req.pipe(bb);
        });

    } catch (err) {
        error('Error sending career application:', err);
        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Failed to submit application. Please try again.'
        });
    }
};

// Free event registration handler - follows same pattern as handlePaymentSuccess
export const handleFreeEventRegistration = async (req, res, next) => {
    try {
        // Security Layer 1: Request size validation
        validateRequestSize(req.body);

        const { email, quantity, eventId, ticketId, merchantId, externalMerchantId, eventName, ticketName, marketingOptIn } = req.body;

        // Security Layer 2: Validate required fields
        if (!email || !quantity || !eventId || !merchantId || !externalMerchantId || !eventName || !ticketName) {
            throw new Error('Missing required fields');
        }

        // Security Layer 3: Validate and sanitize input
        const sanitizedData = {
            email: sanitizeString(email, 100),
            quantity: sanitizeString(String(quantity), 10),
            eventId: sanitizeString(eventId, 50),
            ticketId: ticketId && ticketId !== 'null' ? sanitizeString(ticketId, 50) : null,
            merchantId: sanitizeString(merchantId, 50),
            externalMerchantId: sanitizeString(externalMerchantId, 50),
            eventName: sanitizeString(eventName, 200),
            ticketName: sanitizeString(ticketName, 200),
            marketingOptIn: sanitizeBoolean(marketingOptIn || false)
        };

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(sanitizedData.email)) {
            throw new Error('Invalid email format');
        }

        // Validate quantity
        const quantityNum = parseInt(sanitizedData.quantity);
        if (isNaN(quantityNum) || quantityNum !== 1) {
            throw new Error('Invalid quantity (must be 1)');
        }

        // Validate ID formats
        if (!/^[0-9a-fA-F]{24}$/.test(sanitizedData.eventId) ||
            !/^[0-9a-fA-F]{24}$/.test(sanitizedData.merchantId)) {
            throw new Error('Invalid MongoDB ObjectId format');
        }

        if (sanitizedData.ticketId && !/^[0-9a-fA-F]{24}$/.test(sanitizedData.ticketId)) {
            throw new Error('Invalid ticket ID format');
        }

        // Merchant ID is a numeric string (PostgreSQL style)
        if (!/^\d+$/.test(sanitizedData.externalMerchantId)) {
            throw new Error('Invalid merchant ID format - must be numeric');
        }

        // Validate and check if event exists
        const event = await Event.getEventById(sanitizedData.eventId);
        if (!event) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                success: false,
                error: 'Event not found'
            });
        }

        // Validate and check if merchant exists
        const merchant = await Merchant.getMerchantById(sanitizedData.merchantId);
        if (!merchant) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                success: false,
                error: 'Merchant not found'
            });
        }

        // Verify merchant matches event
        if (event.merchant && event.merchant._id.toString() !== sanitizedData.merchantId) {
            throw new Error('Merchant does not match event');
        }

        // Verify external merchant ID matches
        if (merchant.merchantId !== sanitizedData.externalMerchantId) {
            throw new Error('External merchant ID does not match merchant');
        }

        // Validate and check if event is free
        if (event.otherInfo?.eventExtraInfo?.eventType !== 'free') {
            throw new Error('Event is not free');
        }

        // Validate and check if ticket exists in the event (if ticketId is provided)
        if (sanitizedData.ticketId) {
            const ticketExists = event.ticketInfo && event.ticketInfo.some(ticket => ticket._id.toString() === sanitizedData.ticketId);
            if (!ticketExists) {
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    success: false,
                    error: 'Ticket not found in event'
                });
            }
        }

        // Generate secure OTP using the existing createCode utility
        const otp = await commonUtil.createCode(8); // 8-character alphanumeric OTP

        // Get ticket info (price should be 0 for free events)
        const selectedTicket = sanitizedData.ticketId
            ? event.ticketInfo.find(t => t._id.toString() === sanitizedData.ticketId)
            : (event.ticketInfo && event.ticketInfo.length > 0 ? event.ticketInfo[0] : null);

        const ticketPrice = selectedTicket ? selectedTicket.price : 0;
        const ticketType = selectedTicket ? selectedTicket.name : sanitizedData.ticketName;

        // Create ticketInfo object similar to handlePaymentSuccess
        const ticketInfo = {
            eventName: sanitizedData.eventName,
            ticketName: sanitizedData.ticketName,
            quantity: sanitizedData.quantity,
            price: ticketPrice,
            currency: 'EUR', // Default currency for free events
            purchaseDate: new Date().toISOString(),
            email: sanitizedData.email,
            merchantId: sanitizedData.merchantId,
            eventId: sanitizedData.eventId,
            ticketId: sanitizedData.ticketId || null,
            isFree: true
        };

        // Get or create crypto hash for email (using efficient search)
        const emailCrypto = await hash.getCryptoBySearchIndex(sanitizedData.email, 'email');
        let emailHash = null;
        if (emailCrypto.length == 0) {
            // New email which is not yet in the system
            let tempEmailHash = await hash.createHashData(sanitizedData.email, 'email');
            emailHash = tempEmailHash._id;
        } else {
            emailHash = emailCrypto[0]._id;
        }
        const ticketFor = emailHash;

        // Create the ticket using the same pattern as handlePaymentSuccess
        let ticket = await Ticket.createTicket(
            null, // qrCode - will be generated later
            ticketFor,
            sanitizedData.eventId, // event
            ticketType, // type
            ticketInfo, // ticketInfo
            otp, // otp
            sanitizedData.merchantId,
            sanitizedData.externalMerchantId
        ).catch(err => {
            console.error('Error creating ticket:', err);
            throw err;
        });

        // Generate email payload and send ticket (same as handlePaymentSuccess)
        const emailPayload = await ticketMaster.createEmailPayload(event, ticket, sanitizedData.email, otp);
        await new Promise(resolve => setTimeout(resolve, 100)); // intentional delay
        await sendMail.forward(emailPayload).then(async data => {
            // Update the ticket to mark as sent
            ticket = await Ticket.updateTicketById(ticket._id, { isSend: true });
        }).catch(err => {
            console.error('Error sending ticket email:', err);
            // Don't throw here - ticket is created successfully even if email fails
        });

        const clientId = getClientIdentifier(req);
        console.log('Free event registration handled:', {
            ticketId: ticket._id,
            eventId: sanitizedData.eventId,
            clientId: clientId
        });

        res.status(consts.HTTP_STATUS_OK).json({
            success: true,
            data: ticket,
            message: "Free event registration successful"
        });

        // Publish ticket creation event to notify other systems
        try {
            await publishTicketCreationEvent(ticket, event, sanitizedData, null); // null for paymentIntentId since it's free
        } catch (publishError) {
            console.error('Failed to publish ticket creation event:', publishError);
            // Don't fail the entire operation if event publishing fails
        }

    } catch (error) {
        console.error('Error handling free event registration:', {
            error: error.message,
            clientId: getClientIdentifier(req),
            timestamp: new Date().toISOString()
        });

        const safeErrorMessage = error.message.includes('Missing') ||
                                error.message.includes('Invalid') ||
                                error.message.includes('format') ||
                                error.message.includes('too large') ||
                                error.message.includes('does not match')
                                ? error.message
                                : 'Free event registration temporarily unavailable';

        res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            success: false,
            error: safeErrorMessage
        });
    }
};
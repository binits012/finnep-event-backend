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
import { manifestUpdateService } from '../src/services/manifestUpdateService.js'
import { seatReservationService } from '../src/services/seatReservationService.js'
import * as seatController from './seat.controller.js'
import { EventManifest, Manifest } from '../model/mongoModel.js';
import { Venue } from '../model/mongoModel.js'

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

    // Validate required fields
    // For pricing_configuration model, ticketId can be null if seatTickets is provided
    const hasSeatTickets = metadata.seatTickets && (
        (typeof metadata.seatTickets === 'string' && metadata.seatTickets.trim() !== '[]' && metadata.seatTickets.trim() !== '') ||
        (Array.isArray(metadata.seatTickets) && metadata.seatTickets.length > 0)
    );

    if (!metadata.eventId || !metadata.merchantId) {
        throw new Error('Missing required metadata: eventId and merchantId are required');
    }

    // ticketId is required unless seatTickets is provided (pricing_configuration model)
    if (!metadata.ticketId && !hasSeatTickets) {
        throw new Error('Missing required metadata: ticketId is required (or seatTickets for pricing_configuration model)');
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
        ticketId: metadata.ticketId ? sanitizeString(metadata.ticketId, 50) : null, // Allow null for pricing_configuration
        merchantId: sanitizeString(metadata.merchantId, 50),
        externalMerchantId: sanitizeString(metadata.externalMerchantId || '', 50),
        email: sanitizeString(metadata.email, 100),
        quantity: sanitizeString(metadata.quantity, 10),
        eventName: sanitizeString(metadata.eventName, 200),
        ticketName: sanitizeString(metadata.ticketName, 100),
        country: sanitizeString(metadata.country, 50),
        fullName: metadata.fullName ? sanitizeString(metadata.fullName, 200) : null,
        nonce: metadata.nonce ? sanitizeString(metadata.nonce, 128) : null // Preserve nonce for duplicate submission prevention
    };

    // Preserve seatTickets and placeIds for pricing_configuration model
    if (metadata.seatTickets) {
        sanitizedMetadata.seatTickets = metadata.seatTickets;
    }
    if (metadata.placeIds) {
        sanitizedMetadata.placeIds = metadata.placeIds;
    }

    // Preserve pricing fields for pricing_configuration model
    if (metadata.price !== undefined) sanitizedMetadata.price = parseFloat(metadata.price) || 0;
    if (metadata.basePrice !== undefined) sanitizedMetadata.basePrice = parseFloat(metadata.basePrice) || 0;
    if (metadata.serviceFee !== undefined) sanitizedMetadata.serviceFee = parseFloat(metadata.serviceFee) || 0;
    if (metadata.vat !== undefined) sanitizedMetadata.vat = parseFloat(metadata.vat) || 0;
    if (metadata.vatRate !== undefined) sanitizedMetadata.vatRate = parseFloat(metadata.vatRate) || 0;
    if (metadata.vatAmount !== undefined) sanitizedMetadata.vatAmount = parseFloat(metadata.vatAmount) || 0;
    if (metadata.entertainmentTax !== undefined) sanitizedMetadata.entertainmentTax = parseFloat(metadata.entertainmentTax) || 0;
    if (metadata.serviceTax !== undefined) sanitizedMetadata.serviceTax = parseFloat(metadata.serviceTax) || 0;
    if (metadata.orderFee !== undefined) sanitizedMetadata.orderFee = parseFloat(metadata.orderFee) || 0;

    // Preserve additional pricing breakdown fields
    if (metadata.subtotal !== undefined) sanitizedMetadata.subtotal = parseFloat(metadata.subtotal) || 0;
    if (metadata.entertainmentTaxAmount !== undefined) sanitizedMetadata.entertainmentTaxAmount = parseFloat(metadata.entertainmentTaxAmount) || 0;
    if (metadata.serviceTaxAmount !== undefined) sanitizedMetadata.serviceTaxAmount = parseFloat(metadata.serviceTaxAmount) || 0;
    if (metadata.orderFeeServiceTax !== undefined) sanitizedMetadata.orderFeeServiceTax = parseFloat(metadata.orderFeeServiceTax) || 0;
    if (metadata.perUnitSubtotal !== undefined) sanitizedMetadata.perUnitSubtotal = parseFloat(metadata.perUnitSubtotal) || 0;
    if (metadata.perUnitTotal !== undefined) sanitizedMetadata.perUnitTotal = parseFloat(metadata.perUnitTotal) || 0;
    if (metadata.totalBasePrice !== undefined) sanitizedMetadata.totalBasePrice = parseFloat(metadata.totalBasePrice) || 0;
    if (metadata.totalServiceFee !== undefined) sanitizedMetadata.totalServiceFee = parseFloat(metadata.totalServiceFee) || 0;
    if (metadata.totalVatAmount !== undefined) sanitizedMetadata.totalVatAmount = parseFloat(metadata.totalVatAmount) || 0;
    if (metadata.totalAmount !== undefined) sanitizedMetadata.totalAmount = parseFloat(metadata.totalAmount) || 0;

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

    // ticketId validation - only required if not using pricing_configuration (seatTickets)
    if (sanitizedMetadata.ticketId && !/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.ticketId)) {
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


    // Check if this is pricing_configuration mode (individual seat pricing)
    const isPricingConfiguration = event?.venue?.pricingModel === 'pricing_configuration';

    console.log('event.venue', event.venue);
    if(event.venue && event.venue.venueId) {
        // For pricing_configuration mode, create a dummy ticket object with pricing from metadata
        if (isPricingConfiguration) {
            const dummyTicket = {
                price: metadata.price || 0,
                serviceFee: metadata.serviceFee || 0,
                vat: metadata.vat || 0,
                entertainmentTax: metadata.entertainmentTax || 0,
                serviceTax: metadata.serviceTax || 0,
                orderFee: metadata.orderFee || 0
            };
            return { merchant, event, ticket: dummyTicket };
        } else {
            // For ticket_info mode, find the actual ticket configuration
            if (!metadata.ticketId) {
                throw new Error('Ticket ID is required for ticket_info pricing model');
            }
            const ticketConfig = event.ticketInfo.find(ticket => ticket._id.toString() === metadata.ticketId);
            if (!ticketConfig) {
                throw new Error('Ticket configuration is not available in this event');
            }
            return { merchant, event, ticket: ticketConfig };
        }
    }

    // For non-seat events, find the ticket configuration
    if (!metadata.ticketId) {
        throw new Error('Ticket ID is required');
    }
    const ticketConfig = event.ticketInfo.find(ticket => ticket._id.toString() === metadata.ticketId);
    if (!ticketConfig) {
        throw new Error('Ticket configuration is not available in this event');
    }
    if(ticketConfig.status === 'sold_out') {
        const error = new Error('TICKET_SOLD_OUT');
        error.code = 'TICKET_SOLD_OUT';
        throw error;
    }

    return { merchant, event, ticket: ticketConfig };
};

const calculateExpectedPrice = (ticket, event, quantity, metadata = {}) => {
    // Convert strings to numbers for calculations
    const ticketPrice = parseFloat(ticket.price) || 0;
    const serviceFee = parseFloat(ticket.serviceFee) || 0;
    const vatRate = parseFloat(ticket.vat) || 0;
    const entertainmentTax = parseFloat(ticket.entertainmentTax) || 0;
    const serviceTax = parseFloat(ticket.serviceTax) || 0;
    const orderFee = parseFloat(ticket.orderFee) || 0;
    const qty = parseInt(quantity) || 1;

    // Check if this is a seat-based purchase
    // 1. Check if placeIds are present in metadata
    const hasPlaceIds = metadata.placeIds && (
        (Array.isArray(metadata.placeIds) && metadata.placeIds.length > 0) ||
        (typeof metadata.placeIds === 'string' && metadata.placeIds.trim().length > 0 && metadata.placeIds !== '[]' && metadata.placeIds !== 'null')
    );

    // 2. Check if event has seat selection enabled
    const eventHasSeatSelection = event?.venue?.hasSeatSelection || event?.venue?.venueId;

    // 3. Check if pricing model is 'pricing_configuration' (individual seat pricing)
    const isPricingConfiguration = event?.venue?.pricingModel === 'pricing_configuration';


    // 4. Use new pricing model if either condition is true AND (ticket has new tax fields OR it's pricing_configuration mode)
    const hasSeatSelection = (hasPlaceIds || eventHasSeatSelection) && (entertainmentTax > 0 || serviceTax > 0 || orderFee > 0 || isPricingConfiguration);

    console.log('calculateExpectedPrice - seat selection check:', {
        hasPlaceIds: !!metadata.placeIds,
        placeIds: metadata.placeIds,
        placeIdsType: typeof metadata.placeIds,
        isArray: Array.isArray(metadata.placeIds),
        eventHasSeatSelection,
        entertainmentTax,
        serviceTax,
        orderFee,
        hasSeatSelection,
        isPricingConfiguration,
        hasSeatTickets: !!metadata.seatTickets,
        seatTicketsType: typeof metadata.seatTickets,
        isSeatTicketsArray: Array.isArray(metadata.seatTickets),
        seatTicketsLength: Array.isArray(metadata.seatTickets) ? metadata.seatTickets.length : 0
    });

    if (hasSeatSelection) {
        // Check if using pricing_configuration (individual seat pricing)
        if (isPricingConfiguration && metadata.seatTickets && Array.isArray(metadata.seatTickets) && metadata.seatTickets.length > 0) {
            // Calculate totals first, then calculate percentages on totals (percentage should be on 100, not thousands)
            let totalBasePrice = 0;
            let totalServiceFee = 0;
            let orderFee = 0;
            let taxRate = 0;
            let serviceTaxRate = 0;

            // Sum up base prices and service fees from all seats
            // Ensure we're working with numbers (handle both string and number types)
            metadata.seatTickets.forEach(seatTicket => {
                if (seatTicket.pricing) {
                    const pricing = seatTicket.pricing;
                    const basePrice = typeof pricing.basePrice === 'number' ? pricing.basePrice : (parseFloat(pricing.basePrice) || 0);
                    const serviceFee = typeof pricing.serviceFee === 'number' ? pricing.serviceFee : (parseFloat(pricing.serviceFee) || 0);

                    totalBasePrice += basePrice;
                    totalServiceFee += serviceFee;

                    // Get rates from first seat (all seats have same rates in pricing_configuration)
                    if (taxRate === 0) {
                        taxRate = parseFloat(pricing.tax) || 0;
                        serviceTaxRate = parseFloat(pricing.serviceTax) || 0;
                    }

                    // Order fee (take from first seat with order fee)
                    if (orderFee === 0 && pricing.orderFee) {
                        orderFee = parseFloat(pricing.orderFee) || 0;
                    }
                }
            });

            // Calculate percentages on EXACT totals (not truncated), then truncate result to 3 decimals
            const totalEntertainmentTaxAmount = Math.round((totalBasePrice * taxRate / 100) * 1000) / 1000;
            const totalServiceTaxAmount = Math.round((totalServiceFee * serviceTaxRate / 100) * 1000) / 1000;

            // Now truncate the base totals for consistency
            const totalBasePriceTruncated = Math.round(totalBasePrice * 1000) / 1000;
            const totalServiceFeeTruncated = Math.round(totalServiceFee * 1000) / 1000;
            const orderFeeTax = Math.round((orderFee * serviceTaxRate / 100) * 1000) / 1000;

            // Calculate seat totals: basePrice + tax + serviceFee + serviceTax
            // Use round (not floor) to handle floating-point representation errors when summing
            const seatsTotalTruncated = Math.round((totalBasePriceTruncated + totalEntertainmentTaxAmount + totalServiceFeeTruncated + totalServiceTaxAmount) * 1000) / 1000;
            const orderFeeTotalTruncated = Math.round((orderFee + orderFeeTax) * 1000) / 1000;

            // Grand total (round to handle floating-point errors)
            const totalAmount = Math.round((seatsTotalTruncated + orderFeeTotalTruncated) * 1000) / 1000;

            console.log('Pricing configuration seat-based price calculation:', {
                seatTickets: metadata.seatTickets,
                totalBasePrice: totalBasePriceTruncated,
                totalServiceFee: totalServiceFeeTruncated,
                totalEntertainmentTaxAmount,
                totalServiceTaxAmount,
                seatsTotal: seatsTotalTruncated,
                orderFee,
                orderFeeTax,
                orderFeeTotal: orderFeeTotalTruncated,
                totalAmount
            });

            return {
                perUnitSubtotal: 0, // Not applicable for individual pricing
                perUnitVat: 0, // Not applicable for individual pricing
                perUnitTotal: 0, // Not applicable for individual pricing
                totalAmount: totalAmount
            };
        }

        // For seat-based purchases with ticket pricing model
        // If seatTickets array is provided, calculate price for each seat's ticket individually
        if (metadata.seatTickets && Array.isArray(metadata.seatTickets) && metadata.seatTickets.length > 0) {
            // Calculate total from individual seat tickets
            let seatsTotal = 0;
            let orderFee = 0;
            let orderFeeTax = 0;

            // Sum up pricing for each seat's ticket
            metadata.seatTickets.forEach(seatTicket => {
                // Get ticket config for this seat
                const seatTicketId = seatTicket.ticketId;
                if (!seatTicketId) return;

                const seatTicketConfig = event?.ticketInfo?.find(t => t._id?.toString() === seatTicketId.toString());
                if (!seatTicketConfig) {
                    // Fallback to main ticket if seat ticket not found
                    console.warn(`Ticket ${seatTicketId} not found for seat ${seatTicket.placeId}, using main ticket`);
                }

                const seatTicketData = seatTicketConfig || ticket;
                const basePrice = parseFloat(seatTicketData.price) || 0;
                const entertainmentTaxRate = (parseFloat(seatTicketData.entertainmentTax) || 0) / 100;
                const serviceFee = parseFloat(seatTicketData.serviceFee) || 0;
                const serviceTaxRate = (parseFloat(seatTicketData.serviceTax) || 0) / 100;

                // Per seat: basePrice + (basePrice * entertainmentTax) + serviceFee + (serviceFee * serviceTax)
                const seatPrice = basePrice + (basePrice * entertainmentTaxRate) + serviceFee + (serviceFee * serviceTaxRate);
                const seatPriceTruncated = Math.round(seatPrice * 1000) / 1000;
                seatsTotal += seatPriceTruncated;

                // Order fee (take from first seat with order fee)
                if (orderFee === 0) {
                    orderFee = parseFloat(seatTicketData.orderFee) || 0;
                    // Truncate order fee tax to 3 decimals
                    orderFeeTax = Math.round((orderFee * serviceTaxRate) * 1000) / 1000; // Service tax on order fee
                }
            });

            // Use round (not floor) to handle floating-point representation errors when summing
            const seatsTotalTruncated = Math.round(seatsTotal * 1000) / 1000;
            const orderFeeTaxTruncated = Math.round(orderFeeTax * 1000) / 1000;
            // Use round (not floor) to handle floating-point representation errors
            const orderFeeTotalTruncated = Math.round((orderFee + orderFeeTaxTruncated) * 1000) / 1000;

            // Grand total (round to handle floating-point errors)
            const totalAmount = Math.round((seatsTotalTruncated + orderFeeTotalTruncated) * 1000) / 1000;

            console.log('Ticket info seat-based price calculation (individual tickets):', {
                seatTickets: metadata.seatTickets,
                seatsTotal,
                seatsTotalTruncated,
                orderFee,
                orderFeeTax,
                orderFeeTaxTruncated,
                orderFeeTotalTruncated,
                totalAmount
            });

            return {
                perUnitSubtotal: 0, // Not applicable for individual pricing
                perUnitVat: 0, // Not applicable for individual pricing
                perUnitTotal: 0, // Not applicable for individual pricing
                totalAmount: totalAmount
            };
        }

        // Fallback: For seat-based purchases with single ticket type, use the new pricing model
        // Per ticket calculation: basePrice + (basePrice * entertainmentTax%) + serviceFee + (serviceFee * serviceTax%)
        // Truncate each intermediate calculation to 3 decimals
        const entertainmentTaxAmount = Math.round((ticketPrice * (entertainmentTax / 100)) * 1000) / 1000;
        const serviceTaxAmount = Math.round((serviceFee * (serviceTax / 100)) * 1000) / 1000;
        const perTicketPrice = Math.round((ticketPrice + entertainmentTaxAmount + serviceFee + serviceTaxAmount) * 1000) / 1000;

        // Total for all tickets (truncate each calculation to avoid rounding errors)
        const perTicketPriceTruncated = perTicketPrice; // Already truncated above
        const ticketsTotal = perTicketPriceTruncated * qty;
        // Use round (not floor) to handle floating-point representation errors
        const ticketsTotalRounded = Math.round(ticketsTotal * 1000) / 1000;

        // Order fee (once per transaction) + service tax on order fee
        const orderFeeTax = Math.round((orderFee * (serviceTax / 100)) * 1000) / 1000;
        const orderFeeTotalRounded = Math.round((orderFee + orderFeeTax) * 1000) / 1000;

        // Grand total (round to handle floating-point errors)
        const totalAmount = Math.round((ticketsTotalRounded + orderFeeTotalRounded) * 1000) / 1000;

        console.log('Seat-based price calculation (single ticket type):', {
            ticketPrice,
            entertainmentTax,
            entertainmentTaxAmount,
            serviceFee,
            serviceTax,
            serviceTaxAmount,
            perTicketPrice,
            perTicketPriceTruncated,
            qty,
            ticketsTotal,
            ticketsTotalRounded,
            orderFee,
            orderFeeTax,
            orderFeeTotalRounded,
            totalAmount
        });

        return {
            perUnitSubtotal: ticketPrice + serviceFee,
            perUnitVat: entertainmentTaxAmount + serviceTaxAmount,
            perUnitTotal: perTicketPriceTruncated,
            totalAmount: totalAmount
        };
    } else {
        // Legacy calculation for non-seat purchases (backward compatibility)
        // Calculate per unit subtotal (price + service fee)
        const perUnitSubtotal = ticketPrice + serviceFee;

        // Calculate VAT amount per unit (VAT is only on base price, not service fee)
        const perUnitVat = ticketPrice * (vatRate / 100);

        // Calculate service tax on service fee (per unit)
        const perUnitServiceTax = (serviceFee > 0 && serviceTax > 0)
            ? serviceFee * (serviceTax / 100)
            : 0;

        // Calculate total per unit
        const perUnitTotal = perUnitSubtotal + perUnitVat + perUnitServiceTax;

        // Calculate service tax on order fee (per transaction, not per unit)
        const orderFeeServiceTax = (orderFee > 0 && serviceTax > 0)
            ? orderFee * (serviceTax / 100)
            : 0;

        // Calculate total for all units + order fee + service tax on order fee
        // Order fee is per transaction, not per unit
        const totalAmount = (perUnitTotal * qty) + orderFee + orderFeeServiceTax;

        console.log('Legacy price calculation:', {
            ticketPrice,
            serviceFee,
            vatRate,
            serviceTax,
            orderFee,
            perUnitSubtotal,
            perUnitVat,
            perUnitServiceTax,
            perUnitTotal,
            qty,
            orderFee,
            orderFeeServiceTax,
            totalAmount
        });

        return {
            perUnitSubtotal,
            perUnitVat,
            perUnitTotal,
            totalAmount: Math.round(totalAmount * 1000) / 1000 // Round to handle floating-point errors
        };
    }
};

const validatePriceCalculation = (clientAmount, expectedPrice, tolerance = 0.02) => {
    // Truncate both values to 3 decimal places for comparison (no rounding)
    const clientAmountTruncated = Math.round(clientAmount * 1000) / 1000;
    const expectedAmountTruncated = Math.round(expectedPrice.totalAmount * 1000) / 1000;

    // For seat-based purchases, allow slightly more tolerance due to multiple ticket types
    const difference = Math.abs(clientAmountTruncated - expectedAmountTruncated);
    if (difference > tolerance) {
        throw new Error(`Price calculation mismatch. Expected: ${expectedAmountTruncated}, Received: ${clientAmountTruncated}`);
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

        // Security Layer 2.5: Nonce validation to prevent duplicate form submissions
        if (!metadata.nonce || typeof metadata.nonce !== 'string' || metadata.nonce.length < 32) {
            throw new Error('Invalid or missing nonce. Please refresh the page and try again.');
        }

        // Check if nonce has already been used and store atomically
        // Use SET with NX (only set if not exists) to prevent race conditions
        const nonceKey = `payment_nonce:${metadata.nonce}`;
        const nonceValue = JSON.stringify({
            eventId: metadata.eventId,
            email: metadata.email,
            timestamp: new Date().toISOString(),
            clientId: getClientIdentifier(req)
        });

        // Atomically check and set: returns null if key already exists, 'OK' if set successfully
        const setResult = await redisClient.set(nonceKey, nonceValue, {
            NX: true, // Only set if key does not exist
            EX: 300  // 5 minutes TTL
        });

        if (setResult === null) {
            // Nonce already exists - this is a duplicate submission
            // Get the existing nonce data for logging
            const existingNonce = await redisClient.get(nonceKey);
            let existingData = null;
            try {
                existingData = existingNonce ? JSON.parse(existingNonce) : null;
            } catch (e) {
                // Ignore parse errors
            }

            console.warn('Duplicate payment intent submission detected:', {
                nonce: metadata.nonce,
                eventId: metadata.eventId,
                email: metadata.email,
                clientId: getClientIdentifier(req),
                timestamp: new Date().toISOString(),
                existingData: existingData
            });
            throw new Error('This form has already been submitted. Please refresh the page if you need to make another payment.');
        }

        // Nonce successfully stored - this is a new, valid submission

        // Security Layer 3: Business logic validation
        const { merchant, event, ticket } = await validateMerchantAndEvent(metadata);

        // Security Layer 4: Price validation
        // Parse placeIds and seatTickets if present (for seat-based purchases)
        let parsedMetadata = { ...metadata };
        if (metadata.placeIds) {
            if (typeof metadata.placeIds === 'string') {
                try {
                    parsedMetadata.placeIds = JSON.parse(metadata.placeIds);
                } catch (e) {
                    // If parsing fails, keep as is (might be a single string)
                    parsedMetadata.placeIds = metadata.placeIds;
                }
            }
            // Ensure it's an array if it's a string that looks like JSON array
            if (typeof parsedMetadata.placeIds === 'string' && parsedMetadata.placeIds.trim().startsWith('[')) {
                try {
                    parsedMetadata.placeIds = JSON.parse(parsedMetadata.placeIds);
                } catch (e) {
                    // Keep as is
                }
            }
        }

        // Parse seatTickets if present (for pricing_configuration model)
        if (metadata.seatTickets) {
            if (typeof metadata.seatTickets === 'string') {
                try {
                    parsedMetadata.seatTickets = JSON.parse(metadata.seatTickets);
                } catch (e) {
                    // If parsing fails, keep as is
                    parsedMetadata.seatTickets = metadata.seatTickets;
                }
            }
            // Ensure it's an array if it's a string that looks like JSON array
            if (typeof parsedMetadata.seatTickets === 'string' && parsedMetadata.seatTickets.trim().startsWith('[')) {
                try {
                    parsedMetadata.seatTickets = JSON.parse(parsedMetadata.seatTickets);
                } catch (e) {
                    // Keep as is
                }
            }
        }

        console.log('Price calculation - metadata check:', {
            hasPlaceIds: !!metadata.placeIds,
            placeIdsType: typeof metadata.placeIds,
            placeIdsValue: metadata.placeIds,
            parsedPlaceIds: parsedMetadata.placeIds,
            parsedPlaceIdsType: typeof parsedMetadata.placeIds,
            isArray: Array.isArray(parsedMetadata.placeIds),
            hasSeatTickets: !!metadata.seatTickets,
            seatTicketsType: typeof metadata.seatTickets,
            parsedSeatTickets: parsedMetadata.seatTickets,
            parsedSeatTicketsType: typeof parsedMetadata.seatTickets,
            isSeatTicketsArray: Array.isArray(parsedMetadata.seatTickets)
        });

        const expectedPrice = calculateExpectedPrice(ticket, event, parseInt(metadata.quantity), parsedMetadata);
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

        // Exclude large arrays from Stripe metadata (seatTickets and placeIds can exceed 500 char limit)
        // These are stored in the database and passed in request body, so they don't need to be in Stripe metadata
        const { seatTickets, placeIds, ...stripeMetadata } = metadata;

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
                    ...stripeMetadata,
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
                    ...stripeMetadata,
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

        // Security Layer 2.5: Nonce validation to prevent duplicate form submissions
        // Nonce can come from request metadata or Stripe payment intent metadata (fallback)
        // We'll validate after retrieving payment intent, as nonce might be in Stripe metadata

        // Security Layer 3: Validate payment intent ID format
        if (!/^pi_[a-zA-Z0-9_]+$/.test(paymentIntentId)) {
            throw new Error('Invalid payment intent ID format');
        }

        // Security Layer 3.5: Check if paymentIntentId has already been processed (prevent duplicate ticket creation)
        // We'll check this AFTER retrieving payment intent from Stripe, but before creating ticket
        // This will be done atomically using Redis SET with NX

         // Security Layer 4: Timeout for Stripe API call
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

        // Use paymentIntent.metadata as fallback when req.body.metadata is null or missing fields
        // paymentIntent.metadata is the source of truth from Stripe
        const stripeMetadata = paymentIntent.metadata || {};
        const requestMetadata = metadata || {};

        // Merge metadata: request body takes precedence, but fall back to Stripe metadata
        // NOTE: seatTickets and placeIds are excluded from Stripe metadata due to 500 char limit
        // They MUST always be provided in the request body for seat-based events
        const mergedMetadata = {
            ...stripeMetadata,
            ...requestMetadata,
            // For arrays, prefer request body if present, otherwise use Stripe metadata
            // seatTickets and placeIds are too large for Stripe metadata, so they should always come from request body
            placeIds: requestMetadata.placeIds !== undefined ? requestMetadata.placeIds : [],
            seatTickets: requestMetadata.seatTickets !== undefined ? requestMetadata.seatTickets : [],
            // Nonce: prefer request body, fallback to Stripe metadata
            nonce: requestMetadata.nonce || stripeMetadata.nonce
        };

        // Validate nonce after merging (can come from request or Stripe metadata)
        const nonce = mergedMetadata.nonce;
        if (!nonce || typeof nonce !== 'string' || nonce.length < 32) {
            throw new Error('Invalid or missing nonce. Please refresh the page and try again.');
        }

        // Re-parse placeIds and seatTickets from merged metadata if they're strings
        let finalPlaceIds = mergedMetadata.placeIds || [];
        if (typeof finalPlaceIds === 'string') {
            try {
                finalPlaceIds = JSON.parse(finalPlaceIds);
            } catch (e) {
                finalPlaceIds = [];
            }
        }
        if (!Array.isArray(finalPlaceIds)) {
            finalPlaceIds = [];
        }

        let finalSeatTickets = mergedMetadata.seatTickets || [];
        if (typeof finalSeatTickets === 'string') {
            try {
                finalSeatTickets = JSON.parse(finalSeatTickets);
            } catch (e) {
                finalSeatTickets = [];
            }
        }
        if (!Array.isArray(finalSeatTickets)) {
            finalSeatTickets = [];
        }

        const sanitizedMetadata = {
            eventId: sanitizeString(mergedMetadata.eventId, 50),
            ticketId: mergedMetadata.ticketId ? sanitizeString(mergedMetadata.ticketId, 50) : null, // Allow null for pricing_configuration
            merchantId: sanitizeString(mergedMetadata.merchantId, 50),
            externalMerchantId: sanitizeString(mergedMetadata.externalMerchantId, 50),
            email: sanitizeString(mergedMetadata.email, 100),
            quantity: sanitizeString(mergedMetadata.quantity, 10),
            eventName: sanitizeString(mergedMetadata.eventName, 200),
            ticketName: sanitizeString(mergedMetadata.ticketName, 200),
            marketingOptIn: sanitizeBoolean(mergedMetadata?.marketingOptIn || false),
            placeIds: finalPlaceIds, // Array of place IDs for seat-based events
            seatTickets: finalSeatTickets, // Array of { placeId, ticketId, ticketName } for seat-ticket mapping
            // Additional metadata fields for ticket record - use merged metadata
            fullName: mergedMetadata.fullName ? sanitizeString(mergedMetadata.fullName, 200) : null,
            basePrice: mergedMetadata.basePrice ? sanitizeString(mergedMetadata.basePrice, 20) : null,
            serviceFee: mergedMetadata.serviceFee ? sanitizeString(mergedMetadata.serviceFee, 20) : null,
            vatRate: mergedMetadata.vatRate ? sanitizeString(mergedMetadata.vatRate, 20) : null,
            vatAmount: mergedMetadata.vatAmount !== undefined && mergedMetadata.vatAmount !== null ? sanitizeString(String(mergedMetadata.vatAmount), 20) : null,
            entertainmentTax: mergedMetadata.entertainmentTax !== undefined && mergedMetadata.entertainmentTax !== null ? sanitizeString(String(mergedMetadata.entertainmentTax), 20) : null,
            serviceTax: mergedMetadata.serviceTax ? sanitizeString(mergedMetadata.serviceTax, 20) : null,
            orderFee: mergedMetadata.orderFee ? sanitizeString(mergedMetadata.orderFee, 20) : null,
            country: mergedMetadata.country ? sanitizeString(mergedMetadata.country, 100) : null,
            sessionId: mergedMetadata.sessionId ? sanitizeString(mergedMetadata.sessionId, 100) : null,
            orderFeeServiceTax: mergedMetadata.orderFeeServiceTax ? sanitizeString(mergedMetadata.orderFeeServiceTax, 20) : null,
            serviceTaxAmount: mergedMetadata.serviceTaxAmount ? sanitizeString(mergedMetadata.serviceTaxAmount, 20) : null,
            totalBasePrice: mergedMetadata.totalBasePrice !== undefined && mergedMetadata.totalBasePrice !== null ? sanitizeString(String(mergedMetadata.totalBasePrice), 20) : null,
            totalServiceFee: mergedMetadata.totalServiceFee !== undefined && mergedMetadata.totalServiceFee !== null ? sanitizeString(String(mergedMetadata.totalServiceFee), 20) : null
        };

        console.log('sanitizedMetadata', sanitizedMetadata);
        // Validate ID formats
        // For pricing_configuration model, ticketId can be null if seatTickets is provided
        const hasSeatTickets = finalSeatTickets && Array.isArray(finalSeatTickets) && finalSeatTickets.length > 0;

        if (!/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.eventId) ||
            !/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.merchantId) ) {
            throw new Error('Invalid MongoDB ObjectId format');
        }

        // ticketId validation - only required if not using pricing_configuration (seatTickets)
        if (sanitizedMetadata.ticketId && !/^[0-9a-fA-F]{24}$/.test(sanitizedMetadata.ticketId)) {
            throw new Error('Invalid MongoDB ObjectId format');
        }

        // If ticketId is null, seatTickets must be provided
        if (!sanitizedMetadata.ticketId && !hasSeatTickets) {
            throw new Error('Missing required field: ticketId (or seatTickets for pricing_configuration model)');
        }

        // Merchant ID is a numeric string (PostgreSQL style)
        if (!/^\d+$/.test(sanitizedMetadata.externalMerchantId)) {
            throw new Error('Invalid merchant ID format - must be numeric');
        }



        // Generate secure OTP using the existing createCode utility
        const otp = await commonUtil.createCode(8); // 8-character alphanumeric OTP

        // Get event first to include venue information in ticketInfo
        const event = await Event.getEventById(sanitizedMetadata.eventId);
        if (!event) {
            throw new Error('Event not found');
        }

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
            ticketId: sanitizedMetadata.ticketId,
            // Additional metadata fields
            fullName: sanitizedMetadata.fullName || null,
            // Pricing fields - use sanitizedMetadata values (already parsed as floats)
            basePrice: sanitizedMetadata.basePrice !== undefined ? sanitizedMetadata.basePrice : null,
            serviceFee: sanitizedMetadata.serviceFee !== undefined ? sanitizedMetadata.serviceFee : null,
            vatRate: sanitizedMetadata.vatRate !== undefined ? sanitizedMetadata.vatRate : null,
            vat: sanitizedMetadata.vat !== undefined ? sanitizedMetadata.vat : null,
            vatAmount: sanitizedMetadata.vatAmount !== undefined ? sanitizedMetadata.vatAmount : null,
            entertainmentTax: sanitizedMetadata.entertainmentTax !== undefined ? sanitizedMetadata.entertainmentTax : stripeMetadata.vatRate,
            // Calculate entertainmentTaxAmount if not provided (for backward compatibility)
            // entertainmentTaxAmount = basePrice * (entertainmentTax / 100) * quantity
            entertainmentTaxAmount: sanitizedMetadata.entertainmentTaxAmount !== undefined
                ? sanitizedMetadata.entertainmentTaxAmount
                : (sanitizedMetadata.basePrice && sanitizedMetadata.entertainmentTax && sanitizedMetadata.quantity
                    ? (sanitizedMetadata.basePrice * parseFloat(sanitizedMetadata.entertainmentTax) / 100) * parseFloat(sanitizedMetadata.quantity)
                    : null),
            serviceTax: sanitizedMetadata.serviceTax !== undefined ? sanitizedMetadata.serviceTax : stripeMetadata.serviceTax,
            orderFee: sanitizedMetadata.orderFee !== undefined ? sanitizedMetadata.orderFee : stripeMetadata.orderFee,
            orderFeeServiceTax: sanitizedMetadata.orderFeeServiceTax !== undefined ? sanitizedMetadata.orderFeeServiceTax : stripeMetadata.orderFeeServiceTax,
            serviceTaxAmount: sanitizedMetadata.serviceTaxAmount !== undefined ? sanitizedMetadata.serviceTaxAmount : stripeMetadata.serviceTaxAmount,
            country: sanitizedMetadata.country || null,
            // Store total values for seated events with different ticket types
            totalBasePrice: sanitizedMetadata.totalBasePrice !== undefined ? sanitizedMetadata.totalBasePrice : null,
            totalServiceFee: sanitizedMetadata.totalServiceFee !== undefined ? sanitizedMetadata.totalServiceFee : null
        };
        // Add venue information if available
        if (event && event.venue) {
            ticketInfo.venue = {
                venueId: event.venue.venueId || null,
                externalVenueId: event.venue.externalVenueId || null,
                venueName: event.venue.name || null,
                hasSeatSelection: event.venue.venueId || false
            };
        }

        // Add seat-ticket mapping if available
        if (sanitizedMetadata.seatTickets && sanitizedMetadata.seatTickets.length > 0) {
            ticketInfo.seatTickets = sanitizedMetadata.seatTickets;
        }

        // For seat-based events, store basic seat information
        if (event && event.venue && event.venue.venueId && sanitizedMetadata.placeIds && sanitizedMetadata.placeIds.length > 0) {
            // Just store the placeIds - detailed seat info can be looked up later if needed
            ticketInfo.seats = sanitizedMetadata.placeIds.map(placeId => ({
                placeId: placeId
            }));
        }

        // Security Layer 3.5 (continued): Atomically check and reserve paymentIntentId to prevent duplicate ticket creation
        // This must happen AFTER Stripe validation but BEFORE ticket creation
        const paymentIntentReserveKey = `payment_intent_processed:${paymentIntentId}`;
        const paymentIntentReserveValue = JSON.stringify({
            eventId: sanitizedMetadata.eventId,
            email: sanitizedMetadata.email,
            timestamp: new Date().toISOString(),
            clientId: getClientIdentifier(req),
            status: 'processing' // Mark as processing
        });

        // Atomically check and reserve paymentIntentId (SET with NX)
        const reserveResult = await redisClient.set(paymentIntentReserveKey, paymentIntentReserveValue, {
            NX: true, // Only set if key does not exist
            EX: 600 // 10 minutes TTL
        });

        if (reserveResult === null) {
            // Payment intent has already been processed - this is a duplicate request
            const existingDataStr = await redisClient.get(paymentIntentReserveKey);
            let existingData = null;
            try {
                existingData = existingDataStr ? JSON.parse(existingDataStr) : null;
            } catch (e) {
                // Ignore parse errors
            }

            console.warn('Duplicate payment success request detected:', {
                paymentIntentId,
                eventId: sanitizedMetadata.eventId,
                email: sanitizedMetadata.email,
                clientId: getClientIdentifier(req),
                timestamp: new Date().toISOString(),
                existingData: existingData
            });
            // Return success with message (idempotent) - prevents errors if client retries after network issue
            return res.status(consts.HTTP_STATUS_OK).json({
                success: true,
                message: 'Payment already processed',
                duplicate: true
            });
        }

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
            ticketInfo, // ticketInfo (now includes venue and seat information)
            otp, // otp
            sanitizedMetadata.merchantId,
            sanitizedMetadata.externalMerchantId
        ).catch(err => {
            console.error('Error creating ticket:', err);
            throw err;
        });

        // Generate email payload and send ticket (same as completeOrderTicket)
        // Event is already loaded above
        const emailPayload = await ticketMaster.createEmailPayload(event, ticket, sanitizedMetadata.email, otp);
        await new Promise(resolve => setTimeout(resolve, 100)); // intentional delay
        await sendMail.forward(emailPayload).then(async data => {
            // Update the ticket to mark as sent
            ticket = await Ticket.updateTicketById(ticket._id, { isSend: true });
        }).catch(err => {
            console.error('Error sending ticket email:', err);
            // Don't throw here - ticket is created successfully even if email fails
        });

        // Handle seat marking for seat-based events
        if (event && event.venue && event.venue.venueId && sanitizedMetadata.placeIds && sanitizedMetadata.placeIds.length > 0) {
            try {
                // Find EventManifest by eventId (more reliable than using lockedManifestId)
                const eventMongoId = String(event._id);
                const eventManifest = await EventManifest.findOne({ eventId: eventMongoId });

                if (eventManifest) {
                    // Mark seats as sold in EventManifest
                    await manifestUpdateService.markSeatsAsSold(
                        eventManifest._id.toString(),
                        sanitizedMetadata.placeIds
                    );

                    // Release Redis reservations
                    await seatReservationService.releaseReservations(
                        sanitizedMetadata.eventId,
                        sanitizedMetadata.placeIds
                    );

                    info(`Seats marked as sold for event ${sanitizedMetadata.eventId}: ${sanitizedMetadata.placeIds.length} seats`);
                } else {
                    error(`EventManifest not found for event ${sanitizedMetadata.eventId}. Cannot mark seats as sold.`);
                }
            } catch (seatError) {
                error(`Error marking seats as sold for event ${sanitizedMetadata.eventId}:`, seatError);
                // Don't fail the entire operation if seat marking fails
                // Ticket is already created, seats can be marked manually if needed
            }
        }

        // Update ticket availability (atomic operation)
        //await Ticket.decrementAvailability(sanitizedMetadata.ticketId, parseInt(sanitizedMetadata.quantity));

        const clientId = getClientIdentifier(req);
        console.log('Payment success handled:', {
            paymentIntentId,
            ticketId: ticket._id,
            eventId: sanitizedMetadata.eventId,
            clientId: clientId
        });

        // Update paymentIntentId in Redis with final ticket data (already reserved above)
        // Update the existing key with ticket information
        const paymentIntentStoreKey = `payment_intent_processed:${paymentIntentId}`;
        const paymentIntentValue = JSON.stringify({
            ticketId: ticket._id.toString(),
            eventId: sanitizedMetadata.eventId,
            email: sanitizedMetadata.email,
            timestamp: new Date().toISOString(),
            clientId: clientId,
            status: 'completed' // Mark as completed
        });

        // Update the existing key (it was already set above with NX, now we update it)
        await redisClient.set(paymentIntentStoreKey, paymentIntentValue, {
            EX: 86400 // 24 hours TTL (86400 seconds)
        }).catch(err => {
            // Log but don't fail - ticket is already created
            console.warn('Failed to update paymentIntentId in Redis (non-critical):', err);
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

/**
 * Public seat endpoints (no authentication required)
 * Session-based validation via sessionId (UUID)
 */

/**
 * Decode placeId back to position data
 * @param {string} placeId - Encoded place ID
 * @returns {Object|null} Decoded data or null if invalid
 */
function decodePlaceId(placeId) {
	try {
		if (!placeId || typeof placeId !== 'string') {
			return null;
		}

		// Check if new format (with | separators) or old format
		if (placeId.includes('|')) {
			const parts = placeId.split('|');

			// New format with available and tags: VENUE_PREFIX + SECTION_B64 + "|" + TIER_CODE + "|" + POSITION_CODE + "|" + AVAILABLE_FLAG + "|" + TAGS_CODE
			if (parts.length === 5) {
				const venuePrefix = parts[0].substring(0, 4);
				const sectionB64 = parts[0].substring(4);
				const tierCode = parts[1];
				const positionCode = parts[2];
				const availableFlag = parts[3];
				const tagsCode = parts[4];

				const section = base64UrlDecode(sectionB64);
				const position = decodePosition(positionCode);
				if (!position) {
					return null;
				}

				const available = availableFlag === '1';
				const tags = tagsCode ? base64UrlDecode(tagsCode).split(',').filter(Boolean) : [];

				return {
					section: section,
					tierCode: tierCode,
					row: position.row,
					seat: position.seat,
					x: position.x,
					y: position.y,
					available: available,
					tags: tags
				};
			}
			// Legacy format: VENUE_PREFIX + SECTION_B64 + "|" + TIER_CODE + "|" + POSITION_CODE
			else if (parts.length === 3) {
				const venuePrefix = parts[0].substring(0, 4);
				const sectionB64 = parts[0].substring(4);
				const tierCode = parts[1];
				const positionCode = parts[2];

				const section = base64UrlDecode(sectionB64);
				const position = decodePosition(positionCode);
				if (!position) {
					return null;
				}

				return {
					section: section,
					tierCode: tierCode,
					row: position.row,
					seat: position.seat,
					x: position.x,
					y: position.y,
					available: true,
					tags: []
				};
			} else {
				return null;
			}
		} else {
			// Old format: VENUE_PREFIX + TIER_CODE + SECTION_CHAR + POSITION_CODE
			if (placeId.length < 12) {
				return null;
			}
			const tierCode = placeId.substring(4, 5);
			const sectionChar = placeId.substring(5, 6);
			const positionCode = placeId.substring(6);

			const position = decodePosition(positionCode);
			if (!position) {
				return null;
			}

			return {
				section: sectionChar,
				tierCode: tierCode,
				row: position.row,
				seat: position.seat,
				x: position.x,
				y: position.y,
				available: true,
				tags: []
			};
		}
	} catch (err) {
		console.error(`Error decoding placeId ${placeId}:`, err);
		return null;
	}
}

/**
 * Base64 URL-safe decode
 * @param {string} str - Base64URL encoded string
 * @returns {string} Decoded string
 */
function base64UrlDecode(str) {
	try {
		// Add padding if needed
		let paddedStr = str.replace(/-/g, '+').replace(/_/g, '/');
		while (paddedStr.length % 4 !== 0) {
			paddedStr += '=';
		}
		return Buffer.from(paddedStr, 'base64').toString('utf8');
	} catch (err) {
		console.error('Error decoding base64:', err);
		return str; // Return original if decoding fails
	}
}

/**
 * Decode position code (row, seat, x, y) from base36 encoded string
 * @param {string} positionCode - Base36 encoded position data
 * @returns {Object|null} Decoded position data
 */
function decodePosition(positionCode) {
	try {
		if (!positionCode || positionCode.length < 6) {
			return null;
		}

		// Convert base36 to number
		const combinedValue = parseInt(positionCode, 36);
		if (isNaN(combinedValue)) {
			return null;
		}

		// Extract components using division and bitwise operations
		// row: bits 48-63, seat: bits 32-47, x: bits 16-31, y: bits 0-15
		const row16 = Math.floor(combinedValue / Math.pow(2, 48)) & 0xFFFF;
		const seat16 = Math.floor(combinedValue / Math.pow(2, 32)) & 0xFFFF;
		const x16 = Math.floor(combinedValue / Math.pow(2, 16)) & 0xFFFF;
		const y16 = combinedValue & 0xFFFF;

		return {
			row: row16,
			seat: seat16,
			x: x16,
			y: y16
		};
	} catch (err) {
		console.error('Error decoding position:', err);
		return null;
	}
}

/**
 * Get seat map with availability for an event (public)
 * Returns EventManifest data - frontend will merge with enriched manifest from S3
 */
export const getEventSeatsPublic = async (req, res, next) => {
	try {
		const externalEventId = req.params.eventId; // External event ID from route

		// 1. Get event by external ID to check if it has seat selection enabled
		const event = await Event.getEventById(externalEventId);
		if (!event) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Event not found',
				error: RESOURCE_NOT_FOUND
			});
		}

		// Check if event has seat selection
		if (!event.venue || !event.venue.venueId) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Event does not have seat selection enabled',
				error: 'SEAT_SELECTION_NOT_ENABLED'
			});
		}

		// 2. Load encoded manifest from MongoDB (EventManifest collection) with populated venue
		// EventManifest.eventId stores the internal MongoDB event ID (as string)
		const eventMongoId = String(event._id);

		const encodedManifest = await EventManifest.findOne({ eventId: eventMongoId })
			.populate('venue');


		if (!encodedManifest) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Manifest not found for this event',
				error: RESOURCE_NOT_FOUND
			});
		}


		// 3. Get venue's manifest (contains sections, backgroundSvg, places with coordinates)
		const venueManifest = await Manifest.findOne({ venue: encodedManifest.venue._id })
			.sort({ createdAt: -1 });
		if (!venueManifest) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Venue manifest not found',
				error: RESOURCE_NOT_FOUND
			});
		}

		// 4. Decode placeIds to extract available and tags, and merge with places
		// This works for both pricing_configuration and ticket_info models
		let places = venueManifest.places || [];
		const encodedPlaceIds = encodedManifest.placeIds || [];

		// Create a map of location key (section-row-seat) to decoded placeId data
		const locationToDecodedMap = new Map();

		// Decode all placeIds to extract available and tags
		encodedPlaceIds.forEach(encodedPlaceId => {
			try {
				const decoded = decodePlaceId(encodedPlaceId);
				if (decoded && decoded.section && decoded.row !== null && decoded.seat !== null) {
					// Create multiple possible keys to handle string/number mismatches
					const keys = [
						`${decoded.section}-${decoded.row}-${decoded.seat}`,
						`${decoded.section}-${String(decoded.row)}-${String(decoded.seat)}`,
						`${decoded.section}-${decoded.row}-${String(decoded.seat)}`,
						`${decoded.section}-${String(decoded.row)}-${decoded.seat}`
					];
					keys.forEach(key => {
						if (!locationToDecodedMap.has(key)) {
							locationToDecodedMap.set(key, {
								encodedPlaceId,
								available: decoded.available !== undefined ? decoded.available : true,
								tags: decoded.tags || [],
								tierCode: decoded.tierCode
							});
						}
					});
				}
			} catch (error) {
				console.warn('Failed to decode placeId:', encodedPlaceId, error);
			}
		});

		// If pricingModel is 'pricing_configuration', also decode pricing from placeIds
		if (event.venue?.pricingModel === 'pricing_configuration' && encodedManifest.pricingConfig) {
			// Create a map of tier id to pricing configuration
			const tierMap = new Map();
			encodedManifest.pricingConfig.tiers.forEach(tier => {
				tierMap.set(tier.id, tier);
			});

			// Merge pricing and availability into places by matching section-row-seat
			let placesWithPricing = 0;
			places = places.map(place => {
				// Create multiple possible keys to handle string/number mismatches
				const keys = [
					`${place.section}-${place.row}-${place.seat}`,
					`${String(place.section)}-${String(place.row)}-${String(place.seat)}`,
					`${place.section}-${place.row}-${String(place.seat)}`,
					`${place.section}-${String(place.row)}-${place.seat}`
				];

				let decodedData = null;
				for (const key of keys) {
					decodedData = locationToDecodedMap.get(key);
					if (decodedData) break;
				}

				const enrichedPlace = { ...place };

				// Add available and tags from decoded placeId
				if (decodedData) {
					enrichedPlace.available = decodedData.available;
					enrichedPlace.tags = decodedData.tags;
					enrichedPlace.wheelchairAccessible = decodedData.tags.includes('wheelchair');

					// Extract tier code and add pricing
					if (decodedData.tierCode) {
						const tierPricing = tierMap.get(decodedData.tierCode);
						if (tierPricing) {
							placesWithPricing++;
							enrichedPlace.pricing = {
								basePrice: tierPricing.basePrice,
								tax: tierPricing.tax,
								serviceFee: tierPricing.serviceFee,
								serviceTax: tierPricing.serviceTax,
								orderFee: encodedManifest.pricingConfig.orderFee || 0,
								currency: encodedManifest.pricingConfig.currency || 'EUR'
							};
						}
					}
				} else {
					// Default values if not found in decoded data
					enrichedPlace.available = place.available !== undefined ? place.available : true;
					enrichedPlace.tags = place.tags || [];
					enrichedPlace.wheelchairAccessible = (place.tags || []).includes('wheelchair');
				}

				return enrichedPlace;
			});
		} else {
			// For ticket_info model, just add available and tags
			places = places.map(place => {
				// Create multiple possible keys to handle string/number mismatches
				const keys = [
					`${place.section}-${place.row}-${place.seat}`,
					`${String(place.section)}-${String(place.row)}-${String(place.seat)}`,
					`${place.section}-${place.row}-${String(place.seat)}`,
					`${place.section}-${String(place.row)}-${place.seat}`
				];

				let decodedData = null;
				for (const key of keys) {
					decodedData = locationToDecodedMap.get(key);
					if (decodedData) break;
				}

				if (decodedData) {
					return {
						...place,
						available: decodedData.available,
						tags: decodedData.tags,
						wheelchairAccessible: decodedData.tags.includes('wheelchair')
					};
				} else {
					// Default values if not found in decoded data
					return {
						...place,
						available: place.available !== undefined ? place.available : true,
						tags: place.tags || [],
						wheelchairAccessible: (place.tags || []).includes('wheelchair')
					};
				}
			});
		}

        const venue = await Venue.findById(encodedManifest.venue._id);
		// 5. Get Redis reservations for event (using external event ID for Redis key)
		const reservedMap = await seatReservationService.getReservedSeats(externalEventId);
		const reservedPlaceIds = Array.from(reservedMap.keys());

		// 6. Format sections from venue (contains polygon and spacingConfig)
		const formattedSections = (venue.sections || []).map(section => ({
			id: section.id || section._id?.toString() || section.name,
			name: section.name,
			color: section.color || '#2196F3',
			bounds: section.bounds || null,
			// Clean polygon points to remove MongoDB _id fields
			polygon: section.polygon ? section.polygon.map(point => ({
				x: point.x,
				y: point.y
			})) : null,
			spacingConfig: section.spacingConfig || null
		}));

		// 7. Return EventManifest + Venue Manifest data (everything in one response)
		return res.status(consts.HTTP_STATUS_OK).json({
			data: {
				// EventManifest fields (Ticketmaster format)
				eventId: encodedManifest.eventId,
				updateHash: encodedManifest.updateHash,
				updateTime: encodedManifest.updateTime,
				placeIds: encodedManifest.placeIds || [],
				partitions: encodedManifest.partitions || [],

				// Availability
				sold: encodedManifest.availability?.sold || [],
				reserved: reservedPlaceIds, // From Redis
				// Pricing zones (for price lookup)
				//pricingZones: encodedManifest.pricingZones || [],

				// Pricing configuration (when pricing is encoded in placeIds)
				pricingConfig: encodedManifest.pricingConfig || null,

				// Venue Manifest data (sections, backgroundSvg, places with coordinates)
				backgroundSvg: venue.backgroundSvg || null,
				sections: formattedSections, // Use venue.sections with polygon and spacingConfig
				places: places, // Enriched places with available, tags, and wheelchairAccessible

				// Metadata
				venue: {
					pricingModel: event.venue?.pricingModel || 'ticket_info', // Include pricingModel from event
					sections: formattedSections // Also include in venue object for frontend compatibility
				},
				pricingConfigurationId: encodedManifest.pricingConfigurationId
			}
		});
	} catch (err) {
		error('Error getting event seats (public):', err);
		next(err);
	}
};

/**
 * Reserve seats for an event (public, session-based)
 */
export const reserveSeatsPublic = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const { placeIds, sessionId, email } = req.body;

		if (!placeIds || !Array.isArray(placeIds) || placeIds.length === 0) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'placeIds array is required',
				error: 'INVALID_DATA'
			});
		}

		if (!sessionId) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'sessionId is required',
				error: 'INVALID_DATA'
			});
		}

		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid email address is required',
				error: 'INVALID_EMAIL'
			});
		}

		// Validate sessionId format (UUID)
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(sessionId)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid sessionId format',
				error: 'INVALID_SESSION_ID'
			});
		}

		// Check if seats are available (pass email to allow same-user re-reservation)
		const availability = await seatReservationService.checkAvailability(eventId, placeIds, sessionId, email);
		if (availability.reserved.length > 0) {
			return res.status(consts.HTTP_STATUS_CONFLICT).json({
				message: 'Some seats are already reserved',
				error: 'SEATS_ALREADY_RESERVED',
				data: {
					available: availability.available,
					reserved: availability.reserved
				}
			});
		}

		// Reserve seats
		const result = await seatReservationService.reserveSeats(eventId, placeIds, sessionId, email);

		if (result.failed.length > 0) {
			return res.status(consts.HTTP_STATUS_CONFLICT).json({
				message: 'Some seats could not be reserved',
				error: 'RESERVATION_FAILED',
				data: result
			});
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'Seats reserved successfully',
			data: result
		});
	} catch (err) {
		error('Error reserving seats (public):', err);
		next(err);
	}
};

/**
 * Release seat reservations (public, session-based)
 */
export const releaseSeatsPublic = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const { placeIds, sessionId, email } = req.body;

		if (!placeIds || !Array.isArray(placeIds) || placeIds.length === 0) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'placeIds array is required',
				error: 'INVALID_DATA'
			});
		}

		if (!sessionId) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'sessionId is required',
				error: 'INVALID_DATA'
			});
		}

		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid email address is required',
				error: 'INVALID_EMAIL'
			});
		}

		// Validate sessionId format (UUID)
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(sessionId)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid sessionId format',
				error: 'INVALID_SESSION_ID'
			});
		}

		// Verify reservations belong to this email before releasing
		for (const placeId of placeIds) {
			const reservationSessionId = await seatReservationService.getReservation(eventId, placeId, email);
			if (reservationSessionId && reservationSessionId !== sessionId) {
				return res.status(consts.HTTP_STATUS_CONFLICT).json({
					message: `Seat ${placeId} is reserved by a different session`,
					error: 'SESSION_MISMATCH'
				});
			}
		}

		// Release reservations (pass email to release only this user's reservations)
		const releasedCount = await seatReservationService.releaseReservations(eventId, placeIds, email);

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'Seat reservations released successfully',
			data: { released: releasedCount }
		});
	} catch (err) {
		error('Error releasing seats (public):', err);
		next(err);
	}
};

/**
 * Send OTP for seat selection (public)
 * Similar to guest verification but for seat selection flow
 */
export const sendSeatOTP = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const { email, fullName, placeIds } = req.body;

		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid email address is required',
				error: 'INVALID_EMAIL'
			});
		}

		if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Full name is required',
				error: 'INVALID_NAME'
			});
		}

		if (!placeIds || !Array.isArray(placeIds) || placeIds.length === 0) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'placeIds array is required',
				error: 'INVALID_DATA'
			});
		}

		// Import guest controller functions
		const guestController = await import('./guest.controller.js');

		// Use existing sendVerificationCode logic (doesn't require email to exist)
		// We'll create a simplified version that works for any email
		const VerificationCode = await import('../model/verificationCode.js');
		const sendMail = await import('../util/sendMail.js');
		const common = await import('../util/common.js');

		// Generate 8-digit code
		const generateCode = () => {
			return Math.floor(10000000 + Math.random() * 90000000).toString();
		};

		const code = generateCode();
		const hashedCode = VerificationCode.hashCode(code);

		// Store verification code in Redis with email as key (5 minute TTL)
		// Key format: seat_otp:{eventId}:{email}
		const redisClient = (await import('../model/redisConnect.js')).default;
		const otpKey = `seat_otp:${eventId}:${email}`;
		await redisClient.set(otpKey, hashedCode, 'EX', 300); // 5 minutes

		// Store email and fullName for later verification
		const userDataKey = `seat_user:${eventId}:${email}`;
		await redisClient.set(userDataKey, JSON.stringify({ email, fullName, placeIds }), 'EX', 600); // 10 minutes

		// Send email with code
		const emailHtml = await common.loadVerificationCodeTemplate(code);
		const emailPayload = {
			from: process.env.EMAIL_USERNAME,
			to: email,
			subject: 'Your Seat Selection Verification Code',
			html: emailHtml
		};

		try {
			await sendMail.forward(emailPayload);
		} catch (emailErr) {
			error('Error sending seat OTP email:', emailErr);
			// Don't fail the request if email fails
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'Verification code sent to your email',
			success: true
		});
	} catch (err) {
		error('Error sending seat OTP:', err);
		next(err);
	}
};

/**
 * Verify OTP for seat selection (public)
 */
export const verifySeatOTP = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const { email, otp, placeIds } = req.body;

		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid email address is required',
				error: 'INVALID_EMAIL'
			});
		}

		if (!otp || typeof otp !== 'string' || otp.length !== 8) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid 8-digit code is required',
				error: 'INVALID_OTP'
			});
		}

		if (!placeIds || !Array.isArray(placeIds) || placeIds.length === 0) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'placeIds array is required',
				error: 'INVALID_DATA'
			});
		}

		// Get stored OTP from Redis
		const redisClient = (await import('../model/redisConnect.js')).default;
		const otpKey = `seat_otp:${eventId}:${email}`;
		const storedHashedCode = await redisClient.get(otpKey);

		if (!storedHashedCode) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'No valid verification code found. Please request a new code.',
				error: 'OTP_NOT_FOUND'
			});
		}

		// Verify code
		const VerificationCode = await import('../model/verificationCode.js');
		const isValid = VerificationCode.verifyCode(otp, storedHashedCode);

		if (!isValid) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid verification code',
				error: 'INVALID_OTP'
			});
		}

		// Delete OTP from Redis (one-time use)
		await redisClient.del(otpKey);

		// Get user data
		const userDataKey = `seat_user:${eventId}:${email}`;
		const userDataStr = await redisClient.get(userDataKey);
		if (!userDataStr) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Session expired. Please start over.',
				error: 'SESSION_EXPIRED'
			});
		}

		const userData = JSON.parse(userDataStr);

		// Verify placeIds match
		if (JSON.stringify(userData.placeIds.sort()) !== JSON.stringify(placeIds.sort())) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Selected seats do not match',
				error: 'PLACEIDS_MISMATCH'
			});
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'OTP verified successfully',
			success: true,
			data: {
				email: userData.email,
				fullName: userData.fullName
			}
		});
	} catch (err) {
		error('Error verifying seat OTP:', err);
		next(err);
	}
};

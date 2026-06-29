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
import { assertSiloEventAccess } from '../util/siloFrontTenancy.js'
import * as ticketMaster from '../util/ticketMaster.js'
import {
    applyTicketQuantitiesToTicketInfo,
    eventHasSeatSelection,
    findTicketTypeConfig,
    formatInventoryErrorMessage,
    getScanCountFromTicketType,
    resolveSeatCountFromPurchaseMetadata,
    validateScanCountOrderQuantity,
    validateTicketPurchaseInventory
} from '../util/ticketQuantity.js'
import { computeTicketLinePricing, roundMoney, moneyPercentOfExactSum, moneyPercentOf, moneyAdd } from '../util/money.js'
import * as sendMail from '../util/sendMail.js'
import { isPlatformStripeAccount } from '../util/stripePlatform.js'
import { resolveConfiguredStripePlatformFeeCents, resolveOrderQuantityFromMetadata, scalePlatformFeeByOrderQuantity, copyRecordedPlatformFeeToTicketInfo, PLATFORM_FEE_BASIS } from '../util/merchantPlatformFee.js'
import Stripe from 'stripe'
const stripe = new Stripe(process.env.STRIPE_KEY)
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET
import redisClient from '../model/redisConnect.js'
import * as commonUtil from '../util/common.js'
import * as Merchant from '../model/merchant.js'
import { sanitizePublicEventForFront } from '../util/publicMerchant.js'
import * as OutboxMessage from '../model/outboxMessage.js'
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js'
import { v4 as uuidv4 } from 'uuid'
import busboy from 'busboy'
import { SETTINGS_CACHE_KEY } from '../const.js'
import { manifestUpdateService } from '../src/services/manifestUpdateService.js'
import { seatReservationService } from '../src/services/seatReservationService.js'
import { resolveSoldPlaceIdsForPayment } from '../src/services/paymentSeatResolutionService.js'
import { fulfillSeatPurchaseBeforeTicket, assertSeatsAvailableForPurchase } from '../src/services/seatPurchaseFulfillmentService.js'
import {
    buildCheckoutFulfillmentSnapshot,
    saveCheckoutFulfillmentSnapshot,
    getCheckoutFulfillmentSnapshot,
    deleteCheckoutFulfillmentSnapshot,
    assertPaymentSuccessRequestMatchesSnapshot,
    notifyAdminMissingCheckoutSnapshot,
} from '../util/checkoutFulfillmentSnapshot.js'
import { downloadPricingFromS3 } from '../util/aws.js'
import { loadVenueSectionContext, deriveSectionsFromPlaces } from '../src/services/venueSectionContextService.js'
import * as seatController from './seat.controller.js'
import { EventManifest, Manifest, PlatformMarketingConsent, Survey, SurveyResponse } from '../model/mongoModel.js';
import { Venue } from '../model/mongoModel.js'
import { PersonalDataRequest } from '../model/personalDataRequest.js'
import { getPresalePayload, consumePresaleToken } from '../util/presaleToken.js'
import { getSurveyTokenPayload, consumeSurveyToken } from '../util/surveyToken.js'
import { buildPublicSiteConfigPayload, resolveHostEntry } from '../util/publicSiteConfig.js'
import {
    validateCouponOnEvent,
    applyCouponDiscountToMetadata,
    computeDiscountAmount,
    getBaseSubtotalForCoupon,
    normalizeCouponCode,
    eventHasActiveDiscountCodes,
    computeTicketInfoOrderPricing,
} from '../util/couponPricing.js'
import { publishDiscountCodeRedeemed } from '../util/couponRedeem.js'
import {
    attachCouponFieldsToTicketInfo,
    enrichMetadataWithCouponPricing
} from '../util/ticketDiscountDisplay.js'
import {
    createSeatCheckoutSession,
    deleteSeatCheckoutSession,
    getSeatCheckoutSessionByToken,
    getSeatEmailTrust,
    refreshSeatEmailVerified,
    removePlaceIdsFromSeatCheckoutSession,
    setSeatEmailVerified
} from '../util/seatCheckoutSession.js'
import { validateBusinessLandingConfig } from '../util/businessLanding.js'
import {
    parseRequestMarketCountryCode,
    resolvePublicPlatformSettingSlice,
    resolveMergedPlatformSettings,
    pickDefaultPlatformDoc,
} from '../util/platformSettings.js'
import { resolveTicketEmailOptions, extractCheckoutHostname, shouldUseSiloTicketEmail, resolveSiloCheckoutChannel } from '../util/siloCheckoutEmail.js'
import { normalizeCountryCode, expandCountryAliases } from '../util/regionalAccess.js'
import {
    assertDualPaymentV1Allowed,
    isDualPaymentMerchant,
    resolveStripeCurrency,
} from '../util/nepalPayment.js'

/** ISO 3166-1 alpha-3 (or other mistaken 3-letter codes) → ISO 4217 for Stripe */
const STRIPE_CURRENCY_ALIASES = {
    che: 'chf',
    gbr: 'gbp',
    deu: 'eur',
    fra: 'eur',
    ita: 'eur',
    esp: 'eur',
    usa: 'usd',
    fin: 'eur',
    swe: 'sek',
    nor: 'nok',
    dnk: 'dkk',
};

const normalizeStripeCurrency = (raw) => {
    let c = String(raw ?? '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim()
        .toLowerCase();
    return STRIPE_CURRENCY_ALIASES[c] || c;
};

let warnedCheckoutPaymentMethodTypesPrependedCard = false;

/**
 * PaymentIntent `payment_method_types` for createPaymentIntent (not automatic_payment_methods).
 * Override with env `STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES` — comma-separated Stripe type IDs
 * (see https://stripe.com/docs/api/payment_intents/create#create_payment_intent-payment_method_types).
 * Example: card,afterpay_clearpay,mobilepay,revolut_pay,billie
 * Apple Pay / Google Pay need `card`. If `card` is omitted from env, it is prepended automatically.
 */
function getCheckoutPaymentIntentMethodTypes() {
    const defaults = ['card',  'mobilepay', 'revolut_pay', 'billie'];
    const raw = process.env.STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES;
    if (raw == null || String(raw).trim() === '') {
        return defaults;
    }
    const parts = String(raw)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    const valid = parts.filter((t) => /^[a-z][a-z0-9_]*$/.test(t));
    if (valid.length === 0) {
        console.warn(
            '[Stripe] STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES has no valid entries; using defaults'
        );
        return defaults;
    }
    const deduped = [...new Set(valid)];
    if (!deduped.includes('card')) {
        if (!warnedCheckoutPaymentMethodTypesPrependedCard) {
            warnedCheckoutPaymentMethodTypesPrependedCard = true;
            console.warn(
                '[Stripe] STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES did not include "card" — prepending it (required for Apple Pay / Google Pay).'
            );
        }
        return ['card', ...deduped];
    }
    const withoutCard = deduped.filter((t) => t !== 'card');
    return ['card', ...withoutCard];
}

const resolveSectionMode = (section) => {
	if (!section) return 'seat';
	// Hard guard: Seating sections are always seat-based.
	if (section.sectionType === 'Seating') return 'seat';
	if (section.selectionMode) return section.selectionMode;
	return 'area';
};

const placeHasSeatCoordinates = (place) => {
	if (!place) return false;
	return (
		place.row !== null && place.row !== undefined && String(place.row).trim() !== '' &&
		place.seat !== null && place.seat !== undefined && String(place.seat).trim() !== ''
	);
};

/** True if id looks like a MongoDB ObjectId (24 hex chars); then survey is loaded by _id. */
function isMongoId(id) {
	return typeof id === 'string' && id.length === 24 && /^[a-fA-F0-9]{24}$/.test(id);
}

const isEventCurrentlyValid = (event, now = new Date()) => {
    if (!event) return false;
    const endRaw = event.event_end_date || event.eventEndDate || event.eventDate;
    const endDate = endRaw ? new Date(endRaw) : null;
    if (!endDate || Number.isNaN(endDate.getTime())) return false;
    return endDate >= now;
};

// Only otherInfo.isExternalEvent marks a listing as "external" for UI/geo rules.
// externalEventId / externalMerchantId are set on all merchant-service–synced events.
const isExternalEvent = (event) => {
    if (!event) return false;
    return event?.otherInfo?.isExternalEvent === true;
};

const summarizeEventsForGeoipLog = (events) => {
    const byCountry = {};
    let noCountry = 0;
    let external = 0;
    for (const e of events || []) {
        const raw = e?.country ? String(e.country).trim() : '';
        if (!raw) noCountry += 1;
        else byCountry[raw] = (byCountry[raw] || 0) + 1;
        if (isExternalEvent(e)) external += 1;
    }
    return {
        total: Array.isArray(events) ? events.length : 0,
        byCountry,
        noCountry,
        external,
        sample: (events || []).slice(0, 8).map((e) => ({
            id: e?._id,
            title: e?.eventTitle,
            country: e?.country ?? null,
            external: isExternalEvent(e),
        })),
    };
};

/** Homepage only: keep events whose country matches detected GeoIP / x-country-code (code/name aliases). */
const filterEventsForDetectedCountry = (events, detectedCountryCode) => {
    if (!Array.isArray(events) || events.length === 0) return events || [];
    const detectedNorm = normalizeCountryCode(detectedCountryCode);
    if (!detectedNorm) return events;
    const aliasSet = new Set(
        expandCountryAliases([detectedNorm]).map((a) => String(a).trim().toUpperCase())
    );
    return events.filter((e) => {
        const raw = e?.country;
        if (!raw || !String(raw).trim()) return false;
        const eventNorm = normalizeCountryCode(raw);
        const rawUpper = String(raw).trim().toUpperCase();
        if (eventNorm && eventNorm === detectedNorm) return true;
        return aliasSet.has(rawUpper) || (eventNorm ? aliasSet.has(eventNorm) : false);
    });
};

export const getDataForFront = async (req, res, next) => {
    try {
    // GeoIP + x-country-code fallback; runs in parallel with main data fetch
    const countryPromise = resolveCountryCodeForFrontFilter(req);
    // Fetch all data in parallel (country lookup runs alongside)
    const [photo, notification, event, setting] = await Promise.all([
        Photo.listPhoto(),
        Notification.getActiveNotificationsForFront(),
        Event.getEventsWithTicketCounts(),
        (async () => {
            let setting = await commonUtil.getCacheByKey(redisClient, SETTINGS_CACHE_KEY);
            if (!setting || setting instanceof Error || setting === null) {
                setting = await Setting.getSetting();
            }
            return setting;
        })()
    ]);

    const photoList = Array.isArray(photo) ? photo : [];
    if (!Array.isArray(photo) && photo?.error) {
        error('getDataForFront: listPhoto failed %s', photo.error);
    }

    const photosWithCloudFrontUrls = await Promise.all(photoList.map(async el => {

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

    // Keep validity-window behavior, but still hard-exclude explicitly inactive events.
    const now = new Date();
    const eventList = Array.isArray(event) ? event : [];
    let filteredEvents = eventList.filter(e => e?.active !== false && isEventCurrentlyValid(e, now));

    const detectedCountry = await countryPromise;
    const beforeGeoipSummary = summarizeEventsForGeoipLog(filteredEvents);
    filteredEvents = filterEventsForDetectedCountry(filteredEvents, detectedCountry);
    console.log('[front-geoip] GET /front/', {
        clientIP: getClientIdentifier(req),
        xForwardedFor: req.headers['x-forwarded-for'] || null,
        xRealIp: req.headers['x-real-ip'] || null,
        xCountryCode: parseRequestMarketCountryCode(req),
        detectedCountry,
        beforeFilter: beforeGeoipSummary.total,
        afterFilter: filteredEvents.length,
        before: beforeGeoipSummary,
        after: summarizeEventsForGeoipLog(filteredEvents),
    });

    const notificationList = Array.isArray(notification)
        ? notification
        : []

    const marketCc = parseRequestMarketCountryCode(req)
    const platformSetting = await resolvePublicPlatformSettingSlice(marketCc)

    const data = {
        photo: photosWithCloudFrontUrls?.filter(e => e.publish),
        notification: notificationList,
        event: filteredEvents.map((e) => sanitizePublicEventForFront(e)),
        setting: setting,
        platformSetting,
        companyTitle: process.env.COMPANY_TITLE || 'Okazzo'
    }
    res.status(consts.HTTP_STATUS_OK).json(data)
    } catch (err) {
        error('getDataForFront %s', err?.stack || err);
        if (!res.headersSent) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                message: 'Failed to load front page data',
                error: INTERNAL_SERVER_ERROR
            });
        }
    }
}

/** Slim JSON for storefront: hosts, SEO, CSP manifest origins — cacheable */
export const getPublicSiteConfig = async (req, res, next) => {
    try {
        let setting = await commonUtil.getCacheByKey(redisClient, SETTINGS_CACHE_KEY)
        if (!setting || setting instanceof Error || setting === null) {
            setting = await Setting.getSetting()
        }
        const marketCc = parseRequestMarketCountryCode(req)
        const slice = await resolvePublicPlatformSettingSlice(marketCc)
        const payload = buildPublicSiteConfigPayload(setting, slice.otherInfo)
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
        res.status(consts.HTTP_STATUS_OK).json({
            ...payload,
            platformConfigTier: slice.platformConfigTier,
            platformCountryCode: slice.platformCountryCode
        })
    } catch (err) {
        error('getPublicSiteConfig %s', err?.stack || err)
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            message: 'Failed to load public site config'
        })
    }
}

/** Allowlisted fields from merged otherInfo for public business landing (no raw otherInfo leak). */
function pickPublicBrandingFromOtherInfo(oiPlain, canonicalBaseUrl) {
    const o = oiPlain && typeof oiPlain === 'object' && !Array.isArray(oiPlain) ? oiPlain : {}
    const title = typeof o.companyTitle === 'string' ? o.companyTitle.trim().slice(0, 240) : ''
    let logo = typeof o.companyLogo === 'string' ? o.companyLogo.trim().slice(0, 2000) : ''
    if (logo) {
        if (logo.startsWith('//')) {
            logo = `https:${logo}`
        }
        const base =
            typeof canonicalBaseUrl === 'string' && canonicalBaseUrl.trim()
                ? String(canonicalBaseUrl).replace(/\/+$/, '')
                : ''
        if (logo.startsWith('/') && base) {
            logo = `${base}${logo}`
        }
        if (logo.startsWith('/') && !base) {
            logo = ''
        }
        try {
            const u = new URL(logo)
            if (u.protocol !== 'https:' && u.protocol !== 'http:') {
                logo = ''
            }
        } catch {
            logo = ''
        }
    }
    return {
        companyTitle: title || null,
        companyLogo: logo || null,
    }
}

function pickPublicAppStoreRow(raw) {
    if (!raw || typeof raw !== 'object') return null
    const scanner = typeof raw.scanner === 'string' ? raw.scanner.trim() : ''
    const client = typeof raw.client === 'string' ? raw.client.trim() : ''
    if (!scanner && !client) return null
    return {
        ...(scanner ? { scanner } : {}),
        ...(client ? { client } : {}),
    }
}

/** Public mobile app store links from platform settings (same shape as consumer storefront footer). */
function pickPublicAppDownloads(oiPlain) {
    if (!oiPlain || typeof oiPlain !== 'object') return null
    const googlePlay = pickPublicAppStoreRow(oiPlain.googlePlay)
    const appleStore = pickPublicAppStoreRow(oiPlain.appleStore)
    if (!googlePlay && !appleStore) return null
    return {
        ...(googlePlay ? { googlePlay } : {}),
        ...(appleStore ? { appleStore } : {}),
    }
}

/** Public Stripe card-fee table from platform settings (country key → { percentage, fixed in cents }). */
function pickPublicStripeFees(raw) {
    if (!raw || typeof raw !== 'object') return null
    const out = {}
    for (const [key, val] of Object.entries(raw)) {
        if (!val || typeof val !== 'object') continue
        const pct = Number(val.percentage)
        const fixed = Number(val.fixed)
        if (!Number.isFinite(pct) || !Number.isFinite(fixed)) continue
        out[String(key).toLowerCase()] = { percentage: pct, fixed }
    }
    return Object.keys(out).length ? out : null
}

/** Public B2B landing JSON: structured copy + slim site hints — cacheable, no auth */
export const getBusinessLandingPublic = async (req, res, next) => {
    try {
        let setting = await commonUtil.getCacheByKey(redisClient, SETTINGS_CACHE_KEY)
        if (!setting || setting instanceof Error || setting === null) {
            setting = await Setting.getSetting()
        }
        const marketCc = parseRequestMarketCountryCode(req)
        const slice = await resolvePublicPlatformSettingSlice(marketCc)
        const oiRaw = slice.otherInfo
        const oiPlain =
            oiRaw instanceof Map
                ? Object.fromEntries(oiRaw.entries())
                : oiRaw && typeof oiRaw === 'object'
                  ? { ...oiRaw }
                  : {}
        const raw = oiPlain.businessLanding
        let businessLanding = null
        if (raw != null) {
            const v = validateBusinessLandingConfig(raw)
            if (v.ok) {
                businessLanding = v.normalized
            } else {
                error('getBusinessLandingPublic invalid stored config %j', v.errors)
            }
        }
        const sitePayload = buildPublicSiteConfigPayload(setting, slice.otherInfo)
        const requestHostRaw =
            req.headers['x-forwarded-host'] || req.headers['X-Forwarded-Host'] || req.headers.host || null
        const requestHost = Array.isArray(requestHostRaw) ? requestHostRaw[0] : requestHostRaw
        const resolvedHost = resolveHostEntry(requestHost, sitePayload.hosts)
        const rows = Array.isArray(setting) ? setting : []
        const defaultDoc = pickDefaultPlatformDoc(rows) || rows[0]
        const updatedAt =
            defaultDoc?.updatedAt instanceof Date
                ? defaultDoc.updatedAt.toISOString()
                : defaultDoc?.createdAt instanceof Date
                  ? defaultDoc.createdAt.toISOString()
                  : new Date().toISOString()

        const aboutRaw = slice.aboutSection
        const aboutSection =
            typeof aboutRaw === 'string' && aboutRaw.trim()
                ? aboutRaw.trim().slice(0, 120000)
                : null

        res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300')
        res.status(consts.HTTP_STATUS_OK).json({
            updatedAt,
            platformCountryCode: slice.platformCountryCode,
            platformConfigTier: slice.platformConfigTier,
            businessLanding,
            site: {
                primaryCanonicalBaseUrl: sitePayload.primaryCanonicalBaseUrl,
                hosts: sitePayload.hosts,
                hreflangAlternates: sitePayload.hreflangAlternates,
                resolved: resolvedHost
                    ? {
                          hostname: resolvedHost.hostname,
                          publicBaseUrl: resolvedHost.publicBaseUrl,
                          siteCluster: resolvedHost.siteCluster,
                          market: resolvedHost.market ?? null,
                      }
                    : null,
            },
            contactInfo: slice.contactInfo,
            socialMedia: slice.socialMedia,
            branding: pickPublicBrandingFromOtherInfo(oiPlain, sitePayload.primaryCanonicalBaseUrl),
            aboutSection,
            stripeFees: pickPublicStripeFees(oiPlain.stripeFees),
            appDownloads: pickPublicAppDownloads(oiPlain),
        })
    } catch (err) {
        error('getBusinessLandingPublic %s', err?.stack || err)
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            message: 'Failed to load business landing config',
        })
    }
}

/**
 * Compute single waitlist offer for public app: 'pre_sale' | 'sold_out' | null.
 * Pre-sale when waitlistConfig.pre_sale_enabled; sold_out when sold_out_enabled and at least one ticket sold out.
 */
function computeWaitlistOffer(eventDoc) {
	if (!eventDoc || eventDoc.otherInfo?.eventExtraInfo?.eventType === 'free') return null;
	const wc = eventDoc.waitlistConfig && typeof eventDoc.waitlistConfig === 'object' ? eventDoc.waitlistConfig : {};
	if (wc.pre_sale_enabled) return 'pre_sale';
	const tickets = Array.isArray(eventDoc.ticketInfo) ? eventDoc.ticketInfo : [];
	const hasSoldOut = tickets.some((t) => t && t.status === 'sold_out');
	if (wc.sold_out_enabled && hasSoldOut) return 'sold_out';
	return null;
}

export const getEventById = async (req, res, next) => {
    const id = req.params.id
    const presaleToken = req.query.presale
    try {
        const event = await Event.getEventById(id)
        if (event) {
            if (!assertSiloEventAccess(req, res, event)) return
            let presaleAccess = false
            if (presaleToken && typeof presaleToken === 'string') {
                const payload = await getPresalePayload(redisClient, presaleToken)
                if (payload && String(payload.eventId) === String(id)) {
                    presaleAccess = true
                }
            }

            const discountCodes = event.discountCodes ?? event._doc?.discountCodes
            const eventPayload = sanitizePublicEventForFront(event, {
                presaleAccess,
                hasDiscountCodes: eventHasActiveDiscountCodes(discountCodes),
            })

            const data = { event: eventPayload };
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
                                currency: normalizeStripeCurrency(process.env.PAYMENT_CURRENCY || 'eur'),
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
            // Extract locale from request
            const locale = commonUtil.extractLocaleFromRequest(req);
            const emailPayload = await ticketMaster.createEmailPayload(event, ticket, ticketFor, orderTicket?.otp, locale, {
                marketCountryCode: parseRequestMarketCountryCode(req)
            });
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

                try {
                    const { publishPaymentCompleted } = await import('../services/accountingEventPublisher.js');
                    const paymentIntentId = sessionDetails.payment_intent || sessionDetails.id;
                    let legacyMerchant = null;
                    if (ticketInfo.merchantId) {
                        const merchants = await Merchant.genericSearchMerchant(ticketInfo.merchantId, ticketInfo.externalMerchantId);
                        legacyMerchant = merchants.length > 0 ? merchants[0] : null;
                    }
                    const legacyTicket = ticketData || ticket;
                    await publishPaymentCompleted({
                        ticket: legacyTicket,
                        event,
                        merchant: legacyMerchant || (ticketInfo.merchantId ? { _id: ticketInfo.merchantId, merchantId: ticketInfo.externalMerchantId } : null),
                        method: 'stripe',
                        externalPaymentId: String(paymentIntentId),
                        grossCents: Number(sessionDetails.amount_total || 0),
                        pspFeeCents: 0,
                        checkoutChannel: 'marketplace',
                        currency: (sessionDetails.currency || 'eur').toLowerCase(),
                    });
                } catch (accountingErr) {
                    error('Failed to publish accounting payment.completed for legacy checkout session', { error: accountingErr?.message });
                }

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

        // Full catalog for /events — no GeoIP filter (homepage uses getDataForFront for that).
        const { items, total } = await Event.listEventFiltered({ city, country, page: pageNum, limit: limitNum });
        const activeItems = Array.isArray(items) ? items.filter((item) => item?.active !== false) : [];
        const totalPages = Math.max(Math.ceil(total / limitNum), 1);

        res.status(consts.HTTP_STATUS_OK).json({
            items: activeItems.map((item) => sanitizePublicEventForFront(item)),
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
/** Sync IP / client id from request (never was async — callers that omitted await stored a Promise in Stripe metadata). */
const normalizeClientIp = (ip) => {
    if (!ip || typeof ip !== 'string') return ip;
    const trimmed = ip.trim();
    if (trimmed.startsWith('::ffff:')) {
        return trimmed.slice(7);
    }
    return trimmed;
};

const isPrivateOrLocalIp = (ip) => {
    if (!ip || ip === 'unknown') return true;
    if (ip === '127.0.0.1' || ip === '::1') return true;
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
    if (ip.startsWith('172.')) {
        const second = parseInt(ip.split('.')[1], 10);
        if (second >= 16 && second <= 31) return true;
    }
    return false;
};

const getClientIdentifier = (req) => {
    // Check proxy headers first (x-forwarded-for, x-real-ip)
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        // x-forwarded-for can contain multiple IPs, take the first one
        const firstIP = normalizeClientIp(forwardedFor.split(',')[0]);
        if (firstIP) return firstIP;
    }

    const realIP = req.headers['x-real-ip'];
    if (realIP) return normalizeClientIp(realIP);

    // Fallback to Express req.ip or connection info
    return normalizeClientIp(
        req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown'
    );
};

/** Best-effort Stripe lookup for admin alerts only — never used for fulfillment. */
const tryGetStripePaymentSummaryForAdminAlert = async (paymentIntentId, metadata = {}) => {
    try {
        const merchants = await Merchant.genericSearchMerchant(metadata.merchantId, metadata.externalMerchantId);
        const merchant = merchants.length > 0 ? merchants[0] : null;
        let stripePaymentIntentOptions;
        if (merchant?.stripeAccount && !isPlatformStripeAccount(merchant.stripeAccount)) {
            stripePaymentIntentOptions = { stripeAccount: merchant.stripeAccount };
        }
        const paymentIntent = stripePaymentIntentOptions
            ? await stripe.paymentIntents.retrieve(paymentIntentId, stripePaymentIntentOptions)
            : await stripe.paymentIntents.retrieve(paymentIntentId);
        const stripeMetadata = paymentIntent.metadata || {};
        return {
            status: paymentIntent.status,
            amountCents: paymentIntent.amount,
            currency: paymentIntent.currency,
            email: stripeMetadata.email || metadata.email || null,
            eventId: stripeMetadata.eventId || metadata.eventId || null,
        };
    } catch (retrieveError) {
        return { retrieveError: retrieveError?.message || String(retrieveError) };
    }
};

/**
 * GeoIP lookup via finnep-geoip-service.
 * @returns {Promise<{ code: string, name: string|null }|null>}
 */
const lookupCountryFromIP = async (clientIP) => {
    try {
        if (!clientIP || clientIP === 'unknown' || isPrivateOrLocalIp(clientIP)) {
            return null;
        }

        const geoipServiceUrl = process.env.GEOIP_SERVICE_URL || 'http://localhost:3005';
        const apiKey = process.env.GEOIP_API_KEY;

        if (!apiKey) {
            console.warn('⚠️  GEOIP_API_KEY not configured');
            return null;
        }

        const response = await fetch(`${geoipServiceUrl}/api/lookup/${encodeURIComponent(clientIP)}`, {
            method: 'GET',
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            },
            signal: AbortSignal.timeout(2000)
        });

        const data = await response.json();
        const code = data?.data?.country?.code;
        if (data.success && code) {
            return {
                code: String(code).trim().toUpperCase(),
                name: data.data.country.name || null
            };
        }

        return null;
    } catch (err) {
        console.warn(`⚠️  GeoIP lookup failed for ${clientIP}:`, err.message);
        return null;
    }
};

/**
 * Country for homepage event filter: GeoIP first, then FE x-country-code (hostname), else FI.
 */
const resolveCountryCodeForFrontFilter = async (req) => {
    const clientIP = getClientIdentifier(req);
    const geo = await lookupCountryFromIP(clientIP);
    if (geo?.code) {
        const code = normalizeCountryCode(geo.code);
        console.log('[front-geoip] country resolved via GeoIP', {
            clientIP,
            geoCode: geo.code,
            geoName: geo.name,
            resolved: code,
        });
        return code;
    }

    const marketCc = parseRequestMarketCountryCode(req);
    if (marketCc) {
        const code = normalizeCountryCode(marketCc);
        console.log('[front-geoip] country resolved via x-country-code', {
            clientIP,
            xCountryCode: marketCc,
            resolved: code,
        });
        return code;
    }

    console.warn(`[front-geoip] no GeoIP or x-country-code for ${clientIP}, defaulting to FI`);
    return 'FI';
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
    const { amount, metadata = {} } = reqBody;
    let currency = normalizeStripeCurrency(reqBody.currency);
    console.log('reqBody', reqBody);
    // Validate required fields (amount may be 0 for fully discounted orders)
    if (amount == null || !Number.isFinite(Number(amount)) || !reqBody.currency) {
        throw new Error('Missing required fields: amount and currency are required');
    }
    const normalizedAmount = Math.round(Number(amount));

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

    // Validate amount range (prevent extremely large amounts; allow 0 for fully discounted orders)
    if (normalizedAmount < 0 || normalizedAmount > 10000000) { // Max 100,000.00 in cents
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
        nonce: metadata.nonce ? sanitizeString(metadata.nonce, 128) : null, // Preserve nonce for duplicate submission prevention
        presaleToken: metadata.presaleToken ? sanitizeString(metadata.presaleToken, 200) : null, // One-time presale link token; consumed after successful payment
        couponCode:
            metadata.couponCode != null && String(metadata.couponCode).trim()
                ? sanitizeString(String(metadata.couponCode).trim(), 64)
                : null,
        couponId:
            metadata.couponId != null && String(metadata.couponId).trim()
                ? sanitizeString(String(metadata.couponId).trim(), 32)
                : null
    };
    sanitizedMetadata.useStripePrice =
        metadata.useStripePrice === true || String(metadata.useStripePrice || '').trim() === '1';

    // Preserve seatTickets and placeIds for pricing_configuration model
    if (metadata.seatTickets) {
        sanitizedMetadata.seatTickets = metadata.seatTickets;
    }
    if (metadata.placeIds) {
        sanitizedMetadata.placeIds = metadata.placeIds;
    }
    if (metadata.sectionSelections) {
        sanitizedMetadata.sectionSelections = metadata.sectionSelections;
    }
    if (metadata.sessionId) {
        sanitizedMetadata.sessionId = sanitizeString(metadata.sessionId, 100);
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
    if (metadata.couponDiscountAmount !== undefined) {
        sanitizedMetadata.couponDiscountAmount = parseFloat(metadata.couponDiscountAmount) || 0;
    }
    if (metadata.marketingOptIn !== undefined) {
        sanitizedMetadata.marketingOptIn = sanitizeBoolean(metadata.marketingOptIn);
    }
    if (metadata.locale) {
        sanitizedMetadata.locale = sanitizeString(metadata.locale, 20);
    }
    const paymentProvider = reqBody.paymentProvider || metadata.paymentProvider;
    if (paymentProvider) {
        const normalizedProvider = sanitizeString(String(paymentProvider), 20);
        if (['stripe', 'paytrail', 'nabil'].includes(normalizedProvider)) {
            sanitizedMetadata.paymentProvider = normalizedProvider;
        }
    }

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

    return { amount: normalizedAmount, currency, metadata: sanitizedMetadata };
};

const assertTicketPurchasable = (ticketConfig) => {
    if (!ticketConfig) return;

    if (ticketConfig.status === 'sold_out') {
        const error = new Error('TICKET_SOLD_OUT');
        error.code = 'TICKET_SOLD_OUT';
        throw error;
    }

    if (ticketConfig.status === 'inactive' || ticketConfig.status === 'disabled') {
        const error = new Error('TICKET_NOT_AVAILABLE');
        error.code = 'TICKET_NOT_AVAILABLE';
        throw error;
    }
};

const resolveSeatCountFromMetadata = (metadata = {}) => {
    const placeIds = metadata.placeIds;
    const placeCount = Array.isArray(placeIds)
        ? placeIds.length
        : (typeof placeIds === 'string' && placeIds.trim() ? 1 : 0);
    const seatTickets = metadata.seatTickets;
    const seatTicketCount = Array.isArray(seatTickets) ? seatTickets.length : 0;
    return Math.max(placeCount, seatTicketCount);
};

/**
 * Apply pack-size × order-quantity to ticketInfo.quantity (admission headcount).
 */
const ticketInfoToPlainObjectForPublish = (ticketInfo) => {
    if (!ticketInfo) return {};
    if (ticketInfo instanceof Map) return Object.fromEntries(ticketInfo);
    if (typeof ticketInfo === 'object') return { ...ticketInfo };
    return {};
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
        // NOTE: Frontend sends 'basePrice' not 'price', so we need to check both
        if (isPricingConfiguration) {
            // Prefer entertainmentTax over vat for pricing (align with Flutter and web)
            const effectiveTax = parseFloat(metadata.entertainmentTax) || parseFloat(metadata.vatRate) || parseFloat(metadata.vat) || 0;
            const dummyTicket = {
                price: parseFloat(metadata.basePrice) || parseFloat(metadata.price) || 0,
                serviceFee: parseFloat(metadata.serviceFee) || 0,
                vat: effectiveTax,
                entertainmentTax: parseFloat(metadata.entertainmentTax) || 0,
                serviceTax: parseFloat(metadata.serviceTax) || 0,
                orderFee: parseFloat(metadata.orderFee) || 0
            };
            console.log('[validateMerchantAndEvent] Created dummy ticket for pricing_configuration:', {
                price: dummyTicket.price,
                serviceFee: dummyTicket.serviceFee,
                entertainmentTax: dummyTicket.entertainmentTax,
                serviceTax: dummyTicket.serviceTax,
                orderFee: dummyTicket.orderFee,
                metadataKeys: Object.keys(metadata).filter(k => ['price', 'basePrice', 'serviceFee', 'vatRate', 'vat', 'entertainmentTax', 'serviceTax', 'orderFee'].includes(k))
            });
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
            assertTicketPurchasable(ticketConfig);
            validateTicketPurchaseInventory(event, ticketConfig, {
                orderQuantity: metadata?.quantity ?? 1,
                seatCount: resolveSeatCountFromMetadata(metadata || {}),
                metadata: metadata || {}
            });
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
    assertTicketPurchasable(ticketConfig);
    validateTicketPurchaseInventory(event, ticketConfig, {
        orderQuantity: metadata?.quantity ?? 1,
        seatCount: resolveSeatCountFromMetadata(metadata || {}),
        metadata: metadata || {}
    });

    return { merchant, event, ticket: ticketConfig };
};

const parseMoneyField = (value, fallback = 0) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveTicketForProviderPricing = (ticket, metadata = {}) => {
    const useStripePrice =
        metadata.useStripePrice === true || String(metadata.useStripePrice || '').trim() === '1';
    if (useStripePrice) {
        // stripePrice is major units in event stripeCurrency (e.g. 6 = €6.00); Stripe PI amount is total * 100.
        const stripePrice = ticket?.stripePrice ?? ticket?.stripe_price;
        if (stripePrice != null && Number(stripePrice) > 0) {
            return { ...ticket, price: Number(stripePrice) };
        }
    }
    return ticket;
};

const calculateExpectedPrice = (ticket, event, quantity, metadata = {}) => {
    const ticketForPricing = resolveTicketForProviderPricing(ticket, metadata);
    const qty = parseInt(metadata.quantity || quantity, 10) || 1;

    // Check if this is a seat-based purchase
    const hasPlaceIds = metadata.placeIds && (
        (Array.isArray(metadata.placeIds) && metadata.placeIds.length > 0) ||
        (typeof metadata.placeIds === 'string' && metadata.placeIds.trim().length > 0 && metadata.placeIds !== '[]' && metadata.placeIds !== 'null')
    );

    const seatedEvent = eventHasSeatSelection(event);
    const isPricingConfiguration = event?.venue?.pricingModel === 'pricing_configuration';
    const hasSeatSelection = (hasPlaceIds || seatedEvent) && (
        parseMoneyField(ticket?.entertainmentTax, parseMoneyField(metadata.entertainmentTax)) > 0 ||
        parseMoneyField(ticket?.serviceTax, parseMoneyField(metadata.serviceTax)) > 0 ||
        parseMoneyField(ticket?.orderFee, parseMoneyField(metadata.orderFee)) > 0 ||
        isPricingConfiguration
    );

    // Standard ticket_info checkout: server computes full line from catalog ticket + optional couponCode
    if (!hasSeatSelection) {
        const orderPricing = computeTicketInfoOrderPricing(ticketForPricing, event, qty, metadata);
        if (orderPricing.couponCode) {
            metadata.couponCode = orderPricing.couponCode;
            metadata.couponId = orderPricing.couponId;
            metadata.couponDiscountAmount = orderPricing.couponDiscountAmount;
            metadata.catalogBaseSubtotal = orderPricing.catalogBaseSubtotal;
        }
        console.log('Ticket info order pricing:', {
            catalogUnitBase: orderPricing.catalogUnitBase,
            effectiveUnitBase: orderPricing.effectiveUnitBase,
            couponCode: orderPricing.couponCode,
            couponDiscountAmount: orderPricing.couponDiscountAmount,
            totalAmount: orderPricing.totalAmount
        });
        return {
            perUnitSubtotal: orderPricing.perUnitSubtotal,
            perUnitVat: orderPricing.perUnitVat,
            perUnitTotal: orderPricing.perUnitTotal,
            totalAmount: orderPricing.totalAmount
        };
    }

    const ticketPrice = parseMoneyField(ticket.price);
    const serviceFee =
        parseMoneyField(ticket.serviceFee, parseMoneyField(metadata.serviceFee));
    const entertainmentTax =
        parseMoneyField(ticket.entertainmentTax, parseMoneyField(metadata.entertainmentTax));
    const metadataTaxRate =
        parseMoneyField(metadata.entertainmentTax) || parseMoneyField(metadata.vatRate) || parseMoneyField(metadata.vat);
    const vatRate = entertainmentTax || parseMoneyField(ticket.vat) || metadataTaxRate || 0;
    const serviceTax = parseMoneyField(ticket.serviceTax, parseMoneyField(metadata.serviceTax));
    const orderFee = parseMoneyField(ticket.orderFee, parseMoneyField(metadata.orderFee));

    console.log('calculateExpectedPrice - seat selection check:', {
        hasPlaceIds: !!metadata.placeIds,
        placeIds: metadata.placeIds,
        placeIdsType: typeof metadata.placeIds,
        isArray: Array.isArray(metadata.placeIds),
        seatedEvent,
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
        // PRIORITY 1: Use pre-calculated totals if available (most reliable for pricing_configuration)
        // Frontend sends totalBasePrice, totalServiceFee, entertainmentTaxAmount, serviceTaxAmount, orderFee, orderFeeServiceTax
        const hasTotalFields = metadata.totalBasePrice !== undefined && metadata.totalServiceFee !== undefined;

        // Also check if totals have actual values (not just undefined check)
        const parsedTotalBasePrice = parseFloat(metadata.totalBasePrice);
        const parsedTotalServiceFee = parseFloat(metadata.totalServiceFee);
        const hasMeaningfulTotals = !isNaN(parsedTotalBasePrice) && !isNaN(parsedTotalServiceFee);

        console.log('[calculateExpectedPrice] Checking pre-calculated totals path:', {
            hasSeatSelection,
            isPricingConfiguration,
            hasTotalFields,
            hasMeaningfulTotals,
            'metadata.totalBasePrice': metadata.totalBasePrice,
            'parsedTotalBasePrice': parsedTotalBasePrice,
            'metadata.totalServiceFee': metadata.totalServiceFee,
            'parsedTotalServiceFee': parsedTotalServiceFee,
            'metadata.entertainmentTaxAmount': metadata.entertainmentTaxAmount,
            'metadata.vatAmount': metadata.vatAmount,
            'metadata.serviceTaxAmount': metadata.serviceTaxAmount,
            willUseTotals: isPricingConfiguration && hasTotalFields && hasMeaningfulTotals
        });

        // Use pre-calculated totals ONLY for pricing_configuration mode
        // For ticket_info mode, the "totalBasePrice" and "totalServiceFee" are actually per-unit values,
        // so we need to fall through to the normal calculation that multiplies by quantity
        if (isPricingConfiguration && hasTotalFields && hasMeaningfulTotals) {
            // Use the pre-calculated totals from frontend - they're already computed correctly
            const totalBasePrice = parseFloat(metadata.totalBasePrice) || 0;
            const totalServiceFee = parseFloat(metadata.totalServiceFee) || 0;
            const totalEntertainmentTaxAmount = parseFloat(metadata.entertainmentTaxAmount) || parseFloat(metadata.vatAmount) || 0;
            const totalServiceTaxAmount = parseFloat(metadata.serviceTaxAmount) || 0;
            const orderFee = parseFloat(metadata.orderFee) || 0;
            const orderFeeServiceTax = parseFloat(metadata.orderFeeServiceTax) || 0;

            // Sum all components
            const totalAmount = roundMoney(
                totalBasePrice +
                totalServiceFee +
                totalEntertainmentTaxAmount +
                totalServiceTaxAmount +
                orderFee +
                orderFeeServiceTax
            );

            console.log('[calculateExpectedPrice] Using pre-calculated totals for pricing_configuration:', {
                totalBasePrice,
                totalServiceFee,
                totalEntertainmentTaxAmount,
                totalServiceTaxAmount,
                orderFee,
                orderFeeServiceTax,
                totalAmount
            });

            return {
                perUnitSubtotal: 0,
                perUnitVat: 0,
                perUnitTotal: 0,
                totalAmount: totalAmount
            };
        }

        // PRIORITY 2: Check if using pricing_configuration (individual seat pricing) with seatTickets.pricing
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
            const totalEntertainmentTaxAmount = moneyPercentOfExactSum(totalBasePrice, taxRate);
            const totalServiceTaxAmount = moneyPercentOfExactSum(totalServiceFee, serviceTaxRate);

            // Now truncate the base totals for consistency
            const totalBasePriceTruncated = roundMoney(totalBasePrice);
            const totalServiceFeeTruncated = roundMoney(totalServiceFee);
            const orderFeeTax = roundMoney(orderFee * serviceTaxRate / 100);

            // Calculate seat totals: basePrice + tax + serviceFee + serviceTax
            // Use round (not floor) to handle floating-point representation errors when summing
            const seatsTotalTruncated = roundMoney(totalBasePriceTruncated + totalEntertainmentTaxAmount + totalServiceFeeTruncated + totalServiceTaxAmount);
            const orderFeeTotalTruncated = roundMoney(orderFee + orderFeeTax);

            // Grand total (round to handle floating-point errors)
            const totalAmount = roundMoney(seatsTotalTruncated + orderFeeTotalTruncated);

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
                const seatPriceTruncated = roundMoney(seatPrice);
                seatsTotal += seatPriceTruncated;

                // Order fee (take from first seat with order fee)
                if (orderFee === 0) {
                    orderFee = parseFloat(seatTicketData.orderFee) || 0;
                    // Truncate order fee tax to 3 decimals
                    orderFeeTax = roundMoney(orderFee * serviceTaxRate); // Service tax on order fee
                }
            });

            // Use round (not floor) to handle floating-point representation errors when summing
            const seatsTotalTruncated = roundMoney(seatsTotal);
            const orderFeeTaxTruncated = roundMoney(orderFeeTax);
            // Use round (not floor) to handle floating-point representation errors
            const orderFeeTotalTruncated = roundMoney(orderFee + orderFeeTaxTruncated);

            // Grand total (round to handle floating-point errors)
            const totalAmount = roundMoney(seatsTotalTruncated + orderFeeTotalTruncated);

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
        const entertainmentTaxAmount = roundMoney(ticketPrice * (entertainmentTax / 100));
        const serviceTaxAmount = roundMoney(serviceFee * (serviceTax / 100));
        const perTicketPrice = roundMoney(ticketPrice + entertainmentTaxAmount + serviceFee + serviceTaxAmount);

        // Total for all tickets (truncate each calculation to avoid rounding errors)
        const perTicketPriceTruncated = perTicketPrice; // Already truncated above
        const ticketsTotal = perTicketPriceTruncated * qty;
        // Use round (not floor) to handle floating-point representation errors
        const ticketsTotalRounded = roundMoney(ticketsTotal);

        // Order fee (once per transaction) + service tax on order fee
        const orderFeeTax = roundMoney(orderFee * (serviceTax / 100));
        const orderFeeTotalRounded = roundMoney(orderFee + orderFeeTax);

        // Grand total (round to handle floating-point errors)
        const totalAmount = roundMoney(ticketsTotalRounded + orderFeeTotalRounded);

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
        const pricing = computeTicketLinePricing({
            basePrice: ticketPrice,
            serviceFee,
            vatRatePercent: vatRate,
            serviceTaxRatePercent: serviceTax,
            orderFee,
            quantity: qty
        });

        console.log('Ticket line price calculation:', {
            ticketPrice,
            serviceFee,
            vatRate,
            serviceTax,
            orderFee,
            qty,
            pricing
        });

        return {
            perUnitSubtotal: pricing.perUnitSubtotal,
            perUnitVat: pricing.perUnitVat,
            perUnitTotal: pricing.perUnitTotal,
            totalAmount: pricing.total
        };
    }
};

const validatePriceCalculation = (clientAmount, expectedPrice, tolerance = 0.01) => {
    const clientAmountRounded = roundMoney(clientAmount);
    const expectedAmountRounded = roundMoney(expectedPrice.totalAmount);

    const difference = Math.abs(clientAmountRounded - expectedAmountRounded);
    if (difference > tolerance) {
        throw new Error(`Price calculation mismatch. Expected: ${expectedAmountRounded}, Received: ${clientAmountRounded}`);
    }
};

/**
 * Calculate Stripe processing fee based on country and currency
 * Fetches fee structure from Settings (otherInfo.stripeFees) or uses defaults
 * @param {number} amount - Amount in cents
 * @param {string} currency - Currency code (e.g., 'eur', 'dkk', 'usd')
 * @param {string} country - Country name or code
 * @param {number} platformFee - Platform fee in cents
 * @param {string|null} [marketCountryCode] — merged settings scope (default + optional market row)
 * @returns {Promise<number>} Processing fee in cents
 */
const calculateStripeProcessingFee = async (amount, currency, country, platformFee = 30, marketCountryCode = null) => {
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
        const { merged } = await resolveMergedPlatformSettings(marketCountryCode);
        const stripeFeesConfig = merged?.otherInfo?.stripeFees;

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
            return Math.max(platformFee, totalFee); // Minimum 5 cents
        }
    } catch (err) {
        error('Error fetching Stripe fees from Settings:', err);
    }

    // Fallback to default if Settings lookup fails
    const feeStructure = defaultFees.default;
    const percentageFee = Math.ceil(amount * feeStructure.percentage);
    const totalFee = percentageFee + feeStructure.fixed + platformFee;
    return Math.max(5, totalFee); // Minimum 5 cents
};

/** Warn once if unset — wallets need this for Connect direct charges. */
let warnedMissingStripeCheckoutDomain = false;

/**
 * Public hostname(s) of the Next.js checkout (no scheme/path). Comma-separated OK.
 * e.g. STRIPE_WEB_CHECKOUT_DOMAIN=www.okazzo.eu,okazzo.eu
 * @see https://docs.stripe.com/payments/payment-methods/pmd-registration
 */
function parseStripeCheckoutDomainHostnames() {
    const raw = process.env.STRIPE_WEB_CHECKOUT_DOMAIN;
    if (!raw || typeof raw !== 'string') {
        return [];
    }
    return raw
        .split(',')
        .map((s) =>
            s
                .trim()
                .replace(/^https?:\/\//i, '')
                .split('/')[0]
                .toLowerCase()
        )
        .filter(Boolean);
}

function parseHostnameFromOriginOrReferer(req) {
    if (!req || typeof req.get !== 'function') return null;
    const raw = req.get('Origin') || req.get('Referer');
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    try {
        const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        return url.hostname ? url.hostname.toLowerCase() : null;
    } catch {
        return null;
    }
}

function sanitizeCheckoutHostnameHint(raw) {
    if (typeof raw !== 'string') return null;
    const t = raw.trim().toLowerCase().slice(0, 253);
    if (!t) return null;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(t)) return null;
    return t;
}

/** Host equals an allowlist entry or is a subdomain of one (e.g. www.okazzo.eu under okazzo.eu). */
function isCheckoutHostnameAllowedByBaseList(hostname, baseHostnames) {
    if (!hostname || !Array.isArray(baseHostnames) || baseHostnames.length === 0) return false;
    const h = hostname.toLowerCase();
    return baseHostnames.some((entry) => {
        if (!entry) return false;
        const e = String(entry).toLowerCase();
        return h === e || h.endsWith('.' + e);
    });
}

/**
 * STRIPE_WEB_CHECKOUT_DOMAIN lists at least one base host; merge in the exact hostname from
 * Origin / Referer / body.checkoutHostname when it is a subdomain of (or equal to) an entry.
 * Wallets require PMD for the hostname in the address bar — only listing okazzo.eu does not cover www.okazzo.eu.
 */
function mergeCheckoutHostnamesForPmdRegistration(baseHostnames, req) {
    const normalizedBase = (baseHostnames || [])
        .map((s) => String(s).trim().toLowerCase())
        .filter(Boolean);
    const merged = new Set(normalizedBase);

    if (!req || typeof req.get !== 'function') {
        return [...merged];
    }

    const candidates = [];
    const fromHeader = parseHostnameFromOriginOrReferer(req);
    if (fromHeader) candidates.push(fromHeader);
    const hint = sanitizeCheckoutHostnameHint(req?.body?.checkoutHostname);
    if (hint) candidates.push(hint);

    const seen = new Set();
    for (const c of candidates) {
        if (!c || seen.has(c)) continue;
        seen.add(c);
        if (normalizedBase.length === 0) {
            console.warn(
                `[Stripe payment method domains] Browser hostname "${c}" ignored — set STRIPE_WEB_CHECKOUT_DOMAIN (e.g. okazzo.eu) so subdomains can be registered on the connected account.`
            );
            continue;
        }
        if (!isCheckoutHostnameAllowedByBaseList(c, normalizedBase)) {
            console.warn(
                `[Stripe payment method domains] Browser hostname "${c}" is not under STRIPE_WEB_CHECKOUT_DOMAIN (${normalizedBase.join(', ')}). Register every hostname you use (www vs apex) or wallets stay hidden.`
            );
            continue;
        }
        if (!merged.has(c)) {
            merged.add(c);
            console.log('[Stripe payment method domains] Merging browser hostname into PMD registration list:', c);
        }
    }
    return [...merged];
}

function logPaymentMethodDomainWalletStatus(pmd, contextLabel) {
    if (!pmd) {
        console.warn(`[Stripe payment method domains] ${contextLabel}: no PaymentMethodDomain record`);
        return;
    }
    const apple = pmd.apple_pay?.status ?? 'n/a';
    const google = pmd.google_pay?.status ?? 'n/a';
    console.log('[Stripe payment method domains] wallet eligibility on domain', {
        context: contextLabel,
        domain_name: pmd.domain_name,
        enabled: pmd.enabled,
        apple_pay: apple,
        google_pay: google,
    });
    if (pmd.enabled === false) {
        console.warn(
            `[Stripe] Payment method domain "${pmd.domain_name}" is not enabled — Apple Pay / Google Pay stay hidden in Elements until Stripe marks the domain enabled (finish verification for this ${pmd.livemode ? 'live' : 'test'} domain on the connected account). https://docs.stripe.com/payments/payment-methods/pmd-registration`
        );
    } else if (apple !== 'active' || google !== 'active') {
        console.warn(
            `[Stripe] Domain "${pmd.domain_name}": apple_pay=${apple}, google_pay=${google}. Both should be "active" for wallets on your checkout origin.`
        );
    }
}

async function fetchPaymentMethodDomainByHostname(domain_name, connectedAccountId) {
    const opts =
        typeof connectedAccountId === 'string' && connectedAccountId.startsWith('acct_')
            ? { stripeAccount: connectedAccountId }
            : undefined;
    const list = await stripe.paymentMethodDomains.list({ limit: 100 }, opts);
    return list.data.find((d) => d.domain_name === domain_name) ?? null;
}

/**
 * Apple Pay / Google Pay on the web need the checkout domain registered with Stripe.
 * For Connect *direct charges*, register on the **connected account** via API (platform-only
 * Dashboard registration is not enough). Apple Pay on `checkout.stripe.com` can work while your
 * custom domain fails until this succeeds and Stripe shows the domain **Enabled** for that acct_.
 *
 * Important: `paymentMethodDomains.create` succeeding does not mean wallets work yet — the
 * PaymentMethodDomain object can have `enabled: false` or `apple_pay`/`google_pay` status `inactive`
 * until domain verification completes; Stripe will not show those methods in Elements until then.
 * @see https://docs.stripe.com/api/payment_method_domains/object
 */
async function ensurePaymentMethodDomainsForWallets(connectedAccountId, req) {
    const hostnames = mergeCheckoutHostnamesForPmdRegistration(parseStripeCheckoutDomainHostnames(), req);
    const useConnect =
        typeof connectedAccountId === 'string' && connectedAccountId.startsWith('acct_');
    const cacheAccountKey = useConnect ? connectedAccountId : 'platform';

    // Winston `info()` only hits ./logs/combined.log — always mirror to stdout for ops / Docker / PM2.
    console.log('[Stripe payment method domains]', {
        hostnames: hostnames.length ? hostnames : '(empty — set STRIPE_WEB_CHECKOUT_DOMAIN on this API)',
        registerForStripeAccount: cacheAccountKey,
    });

    if (hostnames.length === 0) {
        if (!warnedMissingStripeCheckoutDomain) {
            warnedMissingStripeCheckoutDomain = true;
            const msg =
                '[Stripe] STRIPE_WEB_CHECKOUT_DOMAIN is not set — Apple Pay / Google Pay usually stay hidden on Connect direct charges until hostnames are registered with paymentMethodDomains (server-side). Set e.g. STRIPE_WEB_CHECKOUT_DOMAIN=okazzo.eu,www.okazzo.eu and restart. https://docs.stripe.com/payments/payment-methods/pmd-registration';
            info(msg);
            console.warn(msg);
        }
        return;
    }

    for (const domain_name of hostnames) {
        // v2: older cache could mark "success" while domain was never enabled — wallets stayed hidden for 7d with no recheck.
        const cacheKey = `stripe_pmd_v2:${cacheAccountKey}:${domain_name}`;
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached === '1') {
                console.log('[Stripe payment method domains] skip Stripe API (Redis cache OK):', cacheKey);
                continue;
            }
        } catch {
            // non-fatal
        }

        let shouldCache = false;
        try {
            let pmd;
            if (useConnect) {
                pmd = await stripe.paymentMethodDomains.create(
                    { domain_name },
                    { stripeAccount: connectedAccountId }
                );
            } else {
                pmd = await stripe.paymentMethodDomains.create({ domain_name });
            }
            logPaymentMethodDomainWalletStatus(pmd, 'create');
            const okMsg = `[Stripe] Registered payment method domain "${domain_name}" for ${cacheAccountKey}.`;
            info(okMsg);
            console.log('[Stripe payment method domains]', okMsg);
            shouldCache = pmd.enabled === true;
            if (!shouldCache) {
                console.warn(
                    `[Stripe payment method domains] Not caching "${domain_name}": enabled=${pmd.enabled} — next checkout will call Stripe again until the domain is enabled.`
                );
            }
        } catch (err) {
            const msg = String(err?.message || err);
            const code = err?.code || err?.raw?.code;
            const benign =
                code === 'resource_already_exists' ||
                /already|duplicate|registered/i.test(msg);
            if (benign) {
                console.log(
                    '[Stripe payment method domains] create returned duplicate; fetching domain status:',
                    cacheAccountKey,
                    domain_name
                );
                try {
                    const existing = await fetchPaymentMethodDomainByHostname(
                        domain_name,
                        useConnect ? connectedAccountId : null
                    );
                    logPaymentMethodDomainWalletStatus(existing, 'existing');
                    shouldCache = existing?.enabled === true;
                    if (!shouldCache) {
                        console.warn(
                            `[Stripe payment method domains] Not caching "${domain_name}": domain missing or enabled=false after duplicate — fix verification in Stripe Dashboard / API.`
                        );
                    }
                } catch (listErr) {
                    console.warn(
                        '[Stripe payment method domains] could not list payment method domains:',
                        String(listErr?.message || listErr)
                    );
                }
            } else {
                console.warn(
                    `[createPaymentIntent] paymentMethodDomains.create (${cacheAccountKey}, ${domain_name}):`,
                    msg
                );
            }
        }

        if (shouldCache) {
            try {
                await redisClient.set(cacheKey, '1', { EX: 7 * 24 * 3600 });
            } catch {
                // non-fatal
            }
        }
    }
}

/** Set STRIPE_LOG_CONNECT_WALLET_PREREQS=1 on the API to log why wallets may stay off (one retrieve per checkout). */
async function logConnectedAccountWalletPrerequisites(stripeAccountId) {
    if (process.env.STRIPE_LOG_CONNECT_WALLET_PREREQS !== '1') return;
    if (!stripeAccountId || !String(stripeAccountId).startsWith('acct_')) return;
    try {
        const acct = await stripe.accounts.retrieve(stripeAccountId);
        const caps = acct.capabilities || {};
        console.log('[Stripe Connect wallet prereqs]', stripeAccountId, {
            charges_enabled: acct.charges_enabled,
            payouts_enabled: acct.payouts_enabled,
            details_submitted: acct.details_submitted,
            card_payments: caps.card_payments,
        });
        if (caps.card_payments !== 'active') {
            console.warn(
                '[Stripe Connect wallet prereqs] `capabilities.card_payments` is not "active" on this connected account. Apple Pay / Google Pay in Elements usually need full card acceptance. Complete Connect onboarding for this account in Stripe Dashboard.'
            );
        }
        if (acct.charges_enabled === false) {
            console.warn(
                '[Stripe Connect wallet prereqs] charges_enabled is false — wallets will not surface until Stripe allows charges on this account.'
            );
        }
    } catch (e) {
        console.warn('[Stripe Connect wallet prereqs] accounts.retrieve failed:', String(e?.message || e));
    }
}

/** Fulfill a paid-event order when server-validated total is €0 (e.g. 100% discount code). */
const completeZeroAmountCheckout = async (req, res, { metadata, parsedMetadata, event, currency, merchant = null }) => {
    const clientId = getClientIdentifier(req);
    const otp = await commonUtil.createCode(8);

    const finalPlaceIds = Array.isArray(parsedMetadata.placeIds) ? parsedMetadata.placeIds : [];
    const finalSeatTickets = Array.isArray(parsedMetadata.seatTickets) ? parsedMetadata.seatTickets : [];
    const finalSectionSelections = Array.isArray(parsedMetadata.sectionSelections)
        ? parsedMetadata.sectionSelections
        : [];

    const ticketTypeConfig = findTicketTypeConfig(event, metadata.ticketId);
    const fulfillmentMetadata = enrichMetadataWithCouponPricing(
        { ...metadata, ...parsedMetadata },
        event,
        ticketTypeConfig
    );
    const zeroCheckoutHostname = extractCheckoutHostname({ req, metadata: fulfillmentMetadata });
    if (zeroCheckoutHostname) {
        fulfillmentMetadata.checkoutHostname = zeroCheckoutHostname;
    }
    const ticketTypeName = ticketTypeConfig?.name || fulfillmentMetadata.ticketName;

    const ticketInfo = {
        eventName: fulfillmentMetadata.eventName,
        ticketName: fulfillmentMetadata.ticketName,
        price: 0,
        totalAmount: 0,
        totalPrice: 0,
        currency: currency.toLowerCase(),
        purchaseDate: new Date().toISOString(),
        paymentProvider: 'discount',
        email: fulfillmentMetadata.email,
        merchantId: fulfillmentMetadata.merchantId,
        eventId: fulfillmentMetadata.eventId,
        ticketId: fulfillmentMetadata.ticketId || null,
        fullName: fulfillmentMetadata.fullName || null,
        basePrice: fulfillmentMetadata.basePrice != null ? String(fulfillmentMetadata.basePrice) : '0',
        serviceFee: fulfillmentMetadata.serviceFee != null ? String(fulfillmentMetadata.serviceFee) : '0',
        vatRate: fulfillmentMetadata.vatRate != null ? String(fulfillmentMetadata.vatRate) : null,
        vatAmount: fulfillmentMetadata.vatAmount != null ? String(fulfillmentMetadata.vatAmount) : '0',
        entertainmentTax: fulfillmentMetadata.entertainmentTax != null ? String(fulfillmentMetadata.entertainmentTax) : null,
        entertainmentTaxAmount: fulfillmentMetadata.entertainmentTaxAmount != null ? String(fulfillmentMetadata.entertainmentTaxAmount) : '0',
        serviceTax: fulfillmentMetadata.serviceTax != null ? String(fulfillmentMetadata.serviceTax) : null,
        serviceTaxAmount: fulfillmentMetadata.serviceTaxAmount != null ? String(fulfillmentMetadata.serviceTaxAmount) : '0',
        orderFee: fulfillmentMetadata.orderFee != null ? String(fulfillmentMetadata.orderFee) : '0',
        orderFeeServiceTax: fulfillmentMetadata.orderFeeServiceTax != null ? String(fulfillmentMetadata.orderFeeServiceTax) : '0',
        totalBasePrice: fulfillmentMetadata.totalBasePrice != null ? String(fulfillmentMetadata.totalBasePrice) : '0',
        totalServiceFee: fulfillmentMetadata.totalServiceFee != null ? String(fulfillmentMetadata.totalServiceFee) : '0',
        country: fulfillmentMetadata.country || null,
        marketingOptIn: fulfillmentMetadata.marketingOptIn || false,
    };
    if (zeroCheckoutHostname) {
        ticketInfo.checkoutHostname = zeroCheckoutHostname;
    }
    attachCouponFieldsToTicketInfo(ticketInfo, fulfillmentMetadata);

    if (event?.venue) {
        ticketInfo.venue = {
            venueId: event.venue.venueId || null,
            externalVenueId: event.venue.externalVenueId || null,
            venueName: event.venue.name || null,
            hasSeatSelection: event.venue.venueId || false
        };
    }
    if (finalSeatTickets.length > 0) {
        ticketInfo.seatTickets = finalSeatTickets;
    }
    if (finalSectionSelections.length > 0) {
        ticketInfo.sectionSelections = finalSectionSelections;
    }
    if (event?.venue?.venueId && finalPlaceIds.length > 0) {
        ticketInfo.seats = finalPlaceIds.map((placeId) => ({ placeId }));
    }

    const seatCount = resolveSeatCountFromMetadata(parsedMetadata);
    const scanCount = getScanCountFromTicketType(ticketTypeConfig);
    const scanValidation = validateScanCountOrderQuantity(fulfillmentMetadata.quantity, scanCount);
    if (!scanValidation.valid) {
        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            success: false,
            error: scanValidation.error
        });
    }

    const { ticketInfo: ticketInfoWithQty, quantities } = applyTicketQuantitiesToTicketInfo(ticketInfo, {
        orderQuantity: fulfillmentMetadata.quantity,
        ticketTypeConfig,
        seatCount
    });
    Object.assign(ticketInfo, ticketInfoWithQty);

    if (fulfillmentMetadata.ticketId) {
        try {
            validateTicketPurchaseInventory(event, ticketTypeConfig, {
                orderQuantity: fulfillmentMetadata.quantity,
                seatCount,
                metadata: parsedMetadata
            });
        } catch (invErr) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: formatInventoryErrorMessage(invErr)
            });
        }
    }

    const emailCrypto = await hash.getCryptoBySearchIndex(fulfillmentMetadata.email, 'email');
    let emailHash = null;
    if (emailCrypto.length === 0) {
        const tempEmailHash = await hash.createHashData(fulfillmentMetadata.email, 'email');
        emailHash = tempEmailHash._id;
    } else {
        emailHash = emailCrypto[0]._id;
    }
    const ticketFor = emailHash;
    await PlatformMarketingConsent.getOrCreatePlatformConsent(ticketFor);

    const isVenueEvent = !!event?.venue?.venueId;
    if (isVenueEvent) {
        try {
            await fulfillSeatPurchaseBeforeTicket({
                eventId: fulfillmentMetadata.eventId,
                event,
                sessionId: fulfillmentMetadata.sessionId,
                placeIds: finalPlaceIds,
                sectionSelections: finalSectionSelections,
                checkoutToken: fulfillmentMetadata.checkoutToken || metadata.checkoutToken || null,
                logPrefix: '[completeZeroAmountCheckout]',
            });
        } catch (seatError) {
            if (seatError?.code === 'SEATS_ALREADY_SOLD') {
                return res.status(consts.HTTP_STATUS_CONFLICT).json({
                    success: false,
                    error: 'SEATS_ALREADY_SOLD',
                    message: seatError.message || 'One or more seats are already sold',
                });
            }
            throw seatError;
        }
    }

    if (fulfillmentMetadata.ticketId) {
        const inventoryDecrement = await Event.decrementTicketTypeAvailable(
            event._id,
            fulfillmentMetadata.ticketId,
            quantities.admissionQuantity,
            ticketTypeConfig
        );
        if (!inventoryDecrement.success) {
            if (isVenueEvent) {
                error(`[completeZeroAmountCheckout] Ticket type inventory drift after seat fulfillment (continuing to honor reserved seats)`, {
                    eventId: fulfillmentMetadata.eventId,
                    ticketId: fulfillmentMetadata.ticketId,
                    admissionQuantity: quantities.admissionQuantity,
                    reason: inventoryDecrement.reason,
                });
            } else {
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    error: 'Not enough tickets remaining for this purchase.'
                });
            }
        }
    }

    let ticket = await Ticket.createTicket(
        null,
        ticketFor,
        fulfillmentMetadata.eventId,
        ticketTypeName,
        ticketInfo,
        otp,
        fulfillmentMetadata.merchantId,
        fulfillmentMetadata.externalMerchantId
    ).catch((err) => {
        console.error('[completeZeroAmountCheckout] Error creating ticket:', err);
        throw err;
    });

    if (!ticket?._id && !ticket?.id) {
        throw new Error('Ticket creation failed');
    }

    await ticketMaster.provisionGroupChildQRCodes(
        ticket,
        event,
        quantities.admissionQuantity,
        {
            eventId: fulfillmentMetadata.eventId,
            merchantId: fulfillmentMetadata.merchantId,
            externalMerchantId: fulfillmentMetadata.externalMerchantId
        }
    );
    ticket = await Ticket.getTicketById(ticket._id, false);

    if (fulfillmentMetadata.presaleToken) {
        const consumed = await consumePresaleToken(redisClient, fulfillmentMetadata.presaleToken);
        if (consumed) {
            info('[completeZeroAmountCheckout] Presale token consumed');
        }
    }

    const paymentReference = `zero_${fulfillmentMetadata.nonce}`;
    if (fulfillmentMetadata.couponCode) {
        try {
            const redeemResult = await Event.decrementCouponUsesLeft(fulfillmentMetadata.eventId, fulfillmentMetadata.couponCode);
            if (redeemResult.ok && event?.externalMerchantId && event?.externalEventId) {
                await publishDiscountCodeRedeemed({
                    externalMerchantId: event.externalMerchantId,
                    externalEventId: String(event.externalEventId),
                    discountCodeId: fulfillmentMetadata.couponId,
                    paymentReference,
                    email: fulfillmentMetadata.email,
                    discountAmount: fulfillmentMetadata.couponDiscountAmount
                });
            } else if (!redeemResult.ok) {
                error('[completeZeroAmountCheckout] Coupon uses_left decrement failed', {
                    eventId: fulfillmentMetadata.eventId,
                    couponCode: fulfillmentMetadata.couponCode,
                    paymentReference
                });
            }
        } catch (couponErr) {
            error('[completeZeroAmountCheckout] Coupon redeem error (non-blocking)', couponErr);
        }
    }

    const { normalizeLocale } = await import('../util/common.js');
    const locale = fulfillmentMetadata.locale ? normalizeLocale(fulfillmentMetadata.locale) : commonUtil.extractLocaleFromRequest(req);

    console.log('[completeZeroAmountCheckout] Order fulfilled:', {
        ticketId: ticket._id,
        eventId: fulfillmentMetadata.eventId,
        clientId,
        couponCode: fulfillmentMetadata.couponCode || null
    });

    ticket = await Ticket.getTicketById(ticket._id, false);
    ticket = await ticketMaster.prepareTicketForClientResponse(event, ticket);

    res.status(consts.HTTP_STATUS_OK).json({
        zeroAmountCheckout: true,
        success: true,
        ticket,
        message: 'Order completed successfully'
    });

    ticketMaster.sendTicketEmailInBackground(event, ticket, fulfillmentMetadata.email, otp, locale, await resolveTicketEmailOptions({
        req,
        merchant,
        metadata: fulfillmentMetadata,
        fulfillment: fulfillmentMetadata,
        marketCountryCode: parseRequestMarketCountryCode(req)
    }));

    try {
        if (event?.event_end_date) {
            ticket.validUntil = new Date(event.event_end_date);
        }
        const ticketForPublish = await Ticket.getTicketById(ticket._id, false);
        await publishTicketCreationEvent(ticketForPublish || ticket, event, fulfillmentMetadata, paymentReference);
    } catch (publishError) {
        console.error('[completeZeroAmountCheckout] Failed to publish ticket creation event:', publishError);
    }

    try {
        const { publishPaymentCompleted } = await import('../services/accountingEventPublisher.js');
        await publishPaymentCompleted({
            ticket,
            event,
            merchant,
            method: 'free',
            externalPaymentId: paymentReference || `free:${ticket._id}`,
            grossCents: 0,
            pspFeeCents: 0,
            checkoutChannel: resolveSiloCheckoutChannel(
                merchant,
                extractCheckoutHostname({ req, metadata: fulfillmentMetadata })
            ),
            currency: (currency || 'eur').toLowerCase(),
        });
    } catch (accountingErr) {
        console.error('[completeZeroAmountCheckout] Failed to publish accounting payment.completed:', accountingErr);
    }
};

export const createPaymentIntent = async (req, res, next) => {
    try {
        // Security Layer 1: Request size validation
        validateRequestSize(req.body);

        // Security Layer 2: Input validation and sanitization
        const { amount, currency, metadata } = validatePaymentRequest(req.body);
        const paymentProvider = req.body.paymentProvider || metadata.paymentProvider || 'stripe';

        if (paymentProvider === 'nabil') {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'NPR payments must use /create-nabil-payment',
            });
        }

        const normalizedCurrency = String(currency || '').trim().toLowerCase();
        if (normalizedCurrency === 'npr') {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'NPR payments must use /create-nabil-payment',
            });
        }

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
        if (!assertSiloEventAccess(req, res, event)) return;

        // Security Layer 3.5: Dual-payment v1 guards (GA only, no coupons)
        let parsedMetadata = { ...metadata, paymentProvider };
        const v1BlockReason = assertDualPaymentV1Allowed({ merchant, event, metadata: parsedMetadata });
        if (v1BlockReason) {
            throw new Error(v1BlockReason);
        }

        const useStripePrice =
            parsedMetadata.useStripePrice === true ||
            String(parsedMetadata.useStripePrice || '').trim() === '1';
        if (useStripePrice && ticket) {
            const expectedCurrency = resolveStripeCurrency(ticket, event);
            if (normalizedCurrency !== expectedCurrency) {
                throw new Error(
                    `Invalid currency for international card checkout. Expected ${expectedCurrency.toUpperCase()}.`
                );
            }
        }

        // Security Layer 4: Price validation
        // Parse placeIds and seatTickets if present (for seat-based purchases)
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

        if (metadata.sectionSelections) {
            if (typeof metadata.sectionSelections === 'string') {
                try {
                    parsedMetadata.sectionSelections = JSON.parse(metadata.sectionSelections);
                } catch (e) {
                    parsedMetadata.sectionSelections = metadata.sectionSelections;
                }
            }
            if (typeof parsedMetadata.sectionSelections === 'string' && parsedMetadata.sectionSelections.trim().startsWith('[')) {
                try {
                    parsedMetadata.sectionSelections = JSON.parse(parsedMetadata.sectionSelections);
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

        if (event?.venue?.venueId) {
            try {
                await assertSeatsAvailableForPurchase({
                    eventId: metadata.eventId,
                    event,
                    sessionId: parsedMetadata.sessionId,
                    placeIds: parsedMetadata.placeIds,
                    sectionSelections: parsedMetadata.sectionSelections,
                    logPrefix: '[createPaymentIntent]',
                });
            } catch (seatError) {
                if (seatError?.code === 'SEATS_ALREADY_SOLD') {
                    return res.status(consts.HTTP_STATUS_CONFLICT).json({
                        success: false,
                        error: 'SEATS_ALREADY_SOLD',
                        message: seatError.message || 'One or more seats are already sold',
                        alreadySold: seatError.alreadySold,
                    });
                }
                throw seatError;
            }
        }

        if (amount === 0 && roundMoney(expectedPrice.totalAmount) === 0) {
            return await completeZeroAmountCheckout(req, res, {
                metadata: { ...metadata, ...parsedMetadata },
                parsedMetadata,
                event,
                currency,
                merchant
            });
        }

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

        const baseAmount = Math.round(amount);
        let stripePaymentIntentPayload;
        let stripePaymentIntentOptions;

        // Exclude large arrays from Stripe metadata (seatTickets and placeIds can exceed 500 char limit)
        // These are stored in the database and passed in request body, so they don't need to be in Stripe metadata
        // Extract locale from metadata for email templates
        const { normalizeLocale } = await import('../util/common.js');
        const locale = metadata.locale ? normalizeLocale(metadata.locale) : 'en-US';
        const { seatTickets, placeIds, locale: _, ...stripeMetadataBase } = metadata;
        const stripeMetadata = {
            ...stripeMetadataBase,
            paymentProvider,
            ...(parsedMetadata.couponCode ? { couponCode: parsedMetadata.couponCode } : {}),
            ...(parsedMetadata.couponId ? { couponId: parsedMetadata.couponId } : {}),
            ...(parsedMetadata.couponDiscountAmount != null
                ? { couponDiscountAmount: String(parsedMetadata.couponDiscountAmount) }
                : {}),
            ...(parsedMetadata.catalogBaseSubtotal != null
                ? { catalogBaseSubtotal: String(parsedMetadata.catalogBaseSubtotal) }
                : {}),
        };

        // Only apply connected account logic if merchant is NOT the platform account
        if (!isPlatformStripeAccount(merchant.stripeAccount)) {

            const orderQuantity = resolveOrderQuantityFromMetadata(parsedMetadata);
            const unitPlatformFee = resolveConfiguredStripePlatformFeeCents(merchant);
            const platformFee = scalePlatformFeeByOrderQuantity(unitPlatformFee, orderQuantity);
            if (!Number.isFinite(platformFee) || platformFee < 0) {
                throw new Error('Invalid Stripe platform fee configuration');
            }
            if (platformFee > 0 && platformFee > baseAmount) {
                throw new Error('Stripe platform fee cannot exceed payment amount');
            }

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
                    clientId: clientId, // Track client for monitoring
                    baseAmount: baseAmount.toString(),
                    platformFee: platformFee.toString(),
                    platformFeeUnitCents: unitPlatformFee > 0 ? unitPlatformFee.toString() : undefined,
                    platformFeeBasis: PLATFORM_FEE_BASIS,
                    orderQuantity: String(orderQuantity),
                    chargeType: 'direct',
                    locale: locale // Store locale for email templates
                },

                payment_method_types: getCheckoutPaymentIntentMethodTypes(),
            };
            if (platformFee > 0) {
                stripePaymentIntentPayload.application_fee_amount = platformFee;
            }
            stripePaymentIntentOptions = {
                stripeAccount: merchant.stripeAccount
            };
        } else {
            const orderQuantity = resolveOrderQuantityFromMetadata(parsedMetadata);
            const unitPlatformFee = resolveConfiguredStripePlatformFeeCents(merchant);
            const platformFee = scalePlatformFeeByOrderQuantity(unitPlatformFee, orderQuantity);
            const platformFeeMetadata = platformFee > 0
                ? {
                    platformFee: platformFee.toString(),
                    platformFeeUnitCents: unitPlatformFee > 0 ? unitPlatformFee.toString() : undefined,
                    platformFeeBasis: PLATFORM_FEE_BASIS,
                    orderQuantity: String(orderQuantity),
                    chargeType: 'platform',
                }
                : {};
            // Platform account - no Stripe application_fee_amount, but record fee for accounting
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
                    clientId: clientId,
                    locale: locale, // Store locale for email templates
                    ...platformFeeMetadata,
                },
                payment_method_types: getCheckoutPaymentIntentMethodTypes(),
            };
        }
        console.log('stripePaymentIntentPayload', stripePaymentIntentPayload, '\n', merchant.stripeAccount);
        await ensurePaymentMethodDomainsForWallets(
            stripePaymentIntentOptions?.stripeAccount || null,
            req
        );
        await logConnectedAccountWalletPrerequisites(stripePaymentIntentOptions?.stripeAccount || null);
        const stripePromise = stripePaymentIntentOptions
            ? stripe.paymentIntents.create(stripePaymentIntentPayload, stripePaymentIntentOptions)
            : stripe.paymentIntents.create(stripePaymentIntentPayload);
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

        await saveCheckoutFulfillmentSnapshot(
            buildCheckoutFulfillmentSnapshot({
                paymentIntentId: paymentIntent.id,
                amountCents: paymentIntent.amount,
                currency: paymentIntent.currency,
                merchant,
                metadata,
                parsedMetadata: {
                    ...parsedMetadata,
                    checkoutHostname: extractCheckoutHostname({ req, metadata: parsedMetadata }),
                    paymentProvider,
                },
                expectedPrice,
                event,
            })
        ).catch(async (snapshotErr) => {
            error('[createPaymentIntent] Failed to save checkout snapshot; cancelling PaymentIntent', {
                paymentIntentId: paymentIntent.id,
                eventId: metadata.eventId,
                error: snapshotErr?.message || String(snapshotErr),
            });
            try {
                if (stripePaymentIntentOptions) {
                    await stripe.paymentIntents.cancel(paymentIntent.id, {}, stripePaymentIntentOptions);
                } else {
                    await stripe.paymentIntents.cancel(paymentIntent.id);
                }
            } catch (cancelErr) {
                error('[createPaymentIntent] Failed to cancel PaymentIntent after snapshot save failure', {
                    paymentIntentId: paymentIntent.id,
                    error: cancelErr?.message || String(cancelErr),
                });
            }
            const err = new Error('Checkout session could not be started. Please try again.');
            err.code = 'CHECKOUT_SNAPSHOT_SAVE_FAILED';
            throw err;
        });

        // Return client secret for frontend
        res.status(consts.HTTP_STATUS_OK).json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status,
            stripeAccount: stripePaymentIntentOptions?.stripeAccount || null
        });

    } catch (error) {
        console.error('Error creating payment intent:', {
            error: error.message,
            clientId: getClientIdentifier(req),
            timestamp: new Date().toISOString()
        });
        console.log('error', error.message);
        const safeErrorMessage = formatInventoryErrorMessage(error);

        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            error: safeErrorMessage,
            code: error.code || undefined
        });
    }
}

const _createPaytrailPaymentInternal = async (req, res, next, { redirectSuccessUrl, redirectCancelUrl } = {}) => {
    try {
        // Security Layer 1: Request size validation
        validateRequestSize(req.body);

        // Security Layer 2: Input validation (reuse existing validatePaymentRequest)
        const { amount, currency, metadata, paymentProvider } = req.body;

        console.log('[createPaytrailPayment] Received metadata:', {
            hasBasePrice: !!metadata?.basePrice,
            hasServiceFee: !!metadata?.serviceFee,
            basePrice: metadata?.basePrice,
            serviceFee: metadata?.serviceFee,
            vatAmount: metadata?.vatAmount,
            metadataKeys: metadata ? Object.keys(metadata) : []
        });

        if (paymentProvider !== 'paytrail') {
            throw new Error('Invalid payment provider');
        }

        const validatedData = validatePaymentRequest(req.body);
        console.log('[createPaytrailPayment] After validation, metadata has:', {
            hasBasePrice: !!metadata?.basePrice,
            basePrice: metadata?.basePrice,
            serviceFee: metadata?.serviceFee,
            vatAmount: metadata?.vatAmount
        });

        // Parse placeIds and seatTickets if present (for seat-based purchases)
        let parsedMetadata = { ...validatedData.metadata };
        if (validatedData.metadata.placeIds) {
            if (typeof validatedData.metadata.placeIds === 'string') {
                try {
                    parsedMetadata.placeIds = JSON.parse(validatedData.metadata.placeIds);
                } catch (e) {
                    // If parsing fails, keep as is (might be a single string)
                    parsedMetadata.placeIds = validatedData.metadata.placeIds;
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

        if (validatedData.metadata.seatTickets) {
            if (typeof validatedData.metadata.seatTickets === 'string') {
                try {
                    parsedMetadata.seatTickets = JSON.parse(validatedData.metadata.seatTickets);
                } catch (e) {
                    // If parsing fails, keep as is
                    parsedMetadata.seatTickets = validatedData.metadata.seatTickets;
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

        if (validatedData.metadata.sectionSelections) {
            if (typeof validatedData.metadata.sectionSelections === 'string') {
                try {
                    parsedMetadata.sectionSelections = JSON.parse(validatedData.metadata.sectionSelections);
                } catch (e) {
                    parsedMetadata.sectionSelections = validatedData.metadata.sectionSelections;
                }
            }
            if (typeof parsedMetadata.sectionSelections === 'string' && parsedMetadata.sectionSelections.trim().startsWith('[')) {
                try {
                    parsedMetadata.sectionSelections = JSON.parse(parsedMetadata.sectionSelections);
                } catch (e) {
                    // Keep as is
                }
            }
        }

        console.log('[createPaytrailPayment] Parsed metadata:', {
            hasPlaceIds: !!parsedMetadata.placeIds,
            placeIdsType: typeof parsedMetadata.placeIds,
            isPlaceIdsArray: Array.isArray(parsedMetadata.placeIds),
            hasSeatTickets: !!parsedMetadata.seatTickets,
            seatTicketsType: typeof parsedMetadata.seatTickets,
            isSeatTicketsArray: Array.isArray(parsedMetadata.seatTickets)
        });

        const { merchant, event, ticket } = await validateMerchantAndEvent(parsedMetadata);
        if (!assertSiloEventAccess(req, res, event)) return;

        // Check if merchant has Paytrail enabled
        if (!merchant.paytrailEnabled) {
            throw new Error('Paytrail is not enabled for this merchant');
        }

        if (event?.venue?.venueId) {
            try {
                await assertSeatsAvailableForPurchase({
                    eventId: parsedMetadata.eventId,
                    event,
                    sessionId: parsedMetadata.sessionId,
                    placeIds: parsedMetadata.placeIds,
                    sectionSelections: parsedMetadata.sectionSelections,
                    logPrefix: '[createPaytrailPayment]',
                });
            } catch (seatError) {
                if (seatError?.code === 'SEATS_ALREADY_SOLD') {
                    return res.status(consts.HTTP_STATUS_CONFLICT).json({
                        success: false,
                        error: 'SEATS_ALREADY_SOLD',
                        message: seatError.message || 'One or more seats are already sold',
                        alreadySold: seatError.alreadySold,
                    });
                }
                throw seatError;
            }
        }

        // Calculate and validate price - use parsedMetadata instead of metadata
        const expectedPrice = calculateExpectedPrice(ticket, event, parseInt(parsedMetadata.quantity), parsedMetadata);
        validatePriceCalculation(amount / 100, expectedPrice);

        // Import Paytrail service
        const paytrailService = (await import('../services/paytrailService.js')).default;

        // Check if shop-in-shop is enabled
        const isShopInShopEnabled = await paytrailService.isShopInShopEnabled();

        if (isShopInShopEnabled) {
            // Shop-in-shop mode: require sub-merchant ID
            if (!merchant.paytrailSubMerchantId) {
                throw new Error('Merchant does not have Paytrail sub-merchant account');
            }
        }

        // Prepare payment items for Paytrail
        // For pricing_configuration, use eventId as productCode since there's no single ticket
        const productCode = ticket._id ? ticket._id.toString() : (parsedMetadata.ticketId || parsedMetadata.eventId || '');
        const quantity = parseInt(parsedMetadata.quantity) || 1;

        // Calculate unitPrice ensuring sum matches total amount exactly
        // Paytrail requires: sum(unitPrice * units) === amount (must be exact match)
        // Strategy: Use floor division, then add remainder to first unit
        const baseUnitPrice = Math.floor(amount / quantity);
        const remainder = amount - (baseUnitPrice * quantity);

        // Create items array - if remainder exists, create multiple items to distribute it
        const items = [];
        if (remainder === 0) {
            // Perfect division - single item with all units
            items.push({
                unitPrice: baseUnitPrice,
                units: quantity,
                vatPercentage: parseFloat(ticket.vat || ticket.entertainmentTax || 0),
                productCode: productCode,
                description: `${parsedMetadata.eventName} - ${parsedMetadata.ticketName || 'Seat Selection'}`,
                deliveryDate: event.eventDate ? event.eventDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                category: 'event_ticket'
            });
        } else {
            // Has remainder - split into two items to ensure exact match
            // First item: baseUnitPrice + remainder, units = 1
            items.push({
                unitPrice: baseUnitPrice + remainder,
                units: 1,
                vatPercentage: parseFloat(ticket.vat || ticket.entertainmentTax || 0),
                productCode: productCode,
                description: `${parsedMetadata.eventName} - ${parsedMetadata.ticketName || 'Seat Selection'}`,
                deliveryDate: event.eventDate ? event.eventDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                category: 'event_ticket'
            });
            // Remaining items: baseUnitPrice, units = quantity - 1
            if (quantity > 1) {
                items.push({
                    unitPrice: baseUnitPrice,
                    units: quantity - 1,
                    vatPercentage: parseFloat(ticket.vat || ticket.entertainmentTax || 0),
                    productCode: productCode,
                    description: `${parsedMetadata.eventName} - ${parsedMetadata.ticketName || 'Seat Selection'}`,
                    deliveryDate: event.eventDate ? event.eventDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                    category: 'event_ticket'
                });
            }
        }

        // Verify the sum matches exactly
        const calculatedTotal = items.reduce((sum, item) => sum + (item.unitPrice * item.units), 0);
        if (calculatedTotal !== amount) {
            throw new Error(`Item sum mismatch: calculated ${calculatedTotal}, expected ${amount}`);
        }

        console.log('[createPaytrailPayment] Item calculation:', {
            amount,
            quantity,
            baseUnitPrice,
            remainder,
            itemsCount: items.length,
            items: items.map(item => ({ unitPrice: item.unitPrice, units: item.units, subtotal: item.unitPrice * item.units })),
            calculatedTotal,
            matches: calculatedTotal === amount
        });

        const customer = {
            email: parsedMetadata.email,
            firstName: parsedMetadata.fullName ? parsedMetadata.fullName.split(' ')[0] : '',
            lastName: parsedMetadata.fullName ? parsedMetadata.fullName.split(' ').slice(1).join(' ') : '',
            phone: parsedMetadata.phone || ''
        };

        let paytrailPayment;
        const paymentOptions = {
            amount: amount,
            currency: currency.toUpperCase(),
            merchantId: metadata.merchantId,
            eventId: metadata.eventId,
            ticketId: metadata.ticketId,
            email: metadata.email,
            items: items,
            customer: customer
        };
        if (redirectSuccessUrl) paymentOptions.redirectSuccessUrl = redirectSuccessUrl;
        if (redirectCancelUrl) paymentOptions.redirectCancelUrl = redirectCancelUrl;
        if (isShopInShopEnabled) {
            paytrailPayment = await paytrailService.createShopInShopPayment({
                ...paymentOptions,
                subMerchantId: merchant.paytrailSubMerchantId,
                commissionRate: merchant.paytrailShopInShopData?.commissionRate
                    || parseFloat(process.env.PAYTRAIL_PLATFORM_COMMISSION || '3')
            });
        } else {
            paytrailPayment = await paytrailService.createSingleAccountPayment({
                ...paymentOptions,
                commissionRate: merchant.paytrailShopInShopData?.commissionRate
                    || parseFloat(process.env.PAYTRAIL_PLATFORM_COMMISSION || '3')
            });
        }

        // Store ALL payment data in Redis for verification (10 minute TTL)
        const paymentKey = `paytrail_payment:${paytrailPayment.stamp}`;
        const redisPaymentData = {
            // All metadata from request (use parsedMetadata for arrays)
            ...parsedMetadata,
            // Payment details
            transactionId: paytrailPayment.transactionId,
            stamp: paytrailPayment.stamp,
            amount: amount,
            currency: currency.toUpperCase(),
            commission: paytrailPayment.commission,
            // Merchant details
            merchantId: parsedMetadata.merchantId,
            externalMerchantId: parsedMetadata.externalMerchantId || merchant.merchantId,
            subMerchantId: isShopInShopEnabled ? merchant.paytrailSubMerchantId : null,
            // Event details
            eventId: parsedMetadata.eventId,
            eventName: parsedMetadata.eventName,
            ticketId: parsedMetadata.ticketId,
            ticketName: parsedMetadata.ticketName,
            ticketTypeId: parsedMetadata.ticketId, // Alias for compatibility
            // Customer details
            email: parsedMetadata.email,
            customerName: parsedMetadata.fullName || parsedMetadata.email.split('@')[0],
            fullName: parsedMetadata.fullName,
            phone: parsedMetadata.phone || '',
            // Quantity and seats (use parsed arrays)
            quantity: parseInt(parsedMetadata.quantity),
            placeIds: Array.isArray(parsedMetadata.placeIds) ? parsedMetadata.placeIds : (parsedMetadata.placeIds || []),
            seatTickets: Array.isArray(parsedMetadata.seatTickets) ? parsedMetadata.seatTickets : (parsedMetadata.seatTickets || []),
            sectionSelections: Array.isArray(parsedMetadata.sectionSelections) ? parsedMetadata.sectionSelections : (parsedMetadata.sectionSelections || []),
            seats: Array.isArray(parsedMetadata.placeIds) ? parsedMetadata.placeIds : (parsedMetadata.placeIds || []),
            // Payment mode
            isShopInShop: isShopInShopEnabled,
            commissionRate: merchant.paytrailShopInShopData?.commissionRate || parseFloat(process.env.PAYTRAIL_PLATFORM_COMMISSION || '3'),
            // Timestamp
            timestamp: new Date().toISOString(),
            locale: parsedMetadata.locale || 'en-US',
            checkoutHostname: extractCheckoutHostname({ req, metadata: parsedMetadata })
        };
        console.log('[createPaytrailPayment] Storing in Redis:', {
            stamp: paytrailPayment.stamp,
            checkoutHostname: redisPaymentData.checkoutHostname,
            hasBasePrice: !!redisPaymentData.basePrice,
            hasServiceFee: !!redisPaymentData.serviceFee,
            basePrice: redisPaymentData.basePrice,
            serviceFee: redisPaymentData.serviceFee,
            vatAmount: redisPaymentData.vatAmount,
            amount: redisPaymentData.amount
        });
        await redisClient.set(paymentKey, JSON.stringify(redisPaymentData), { EX: 600 }); // 10 minutes TTL

        if (isShopInShopEnabled) {
            info(`Paytrail shop-in-shop payment created: ${paytrailPayment.transactionId} for sub-merchant ${merchant.paytrailSubMerchantId}`);
        } else {
            info(`Paytrail single account payment created: ${paytrailPayment.transactionId} for merchant ${metadata.merchantId}`);
        }

        // Return payment URL for redirect
        res.status(consts.HTTP_STATUS_OK).json({
            paymentUrl: paytrailPayment.href,
            transactionId: paytrailPayment.transactionId,
            stamp: paytrailPayment.stamp,
            provider: 'paytrail',
            commission: paytrailPayment.commission
        });

    } catch (error) {
        console.error('Error creating Paytrail payment:', error);
        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            error: formatInventoryErrorMessage(error)
        });
    }
}

// Web/default flow (no app deep-link redirect)
export const createPaytrailPayment = async (req, res, next) => {
    return _createPaytrailPaymentInternal(req, res, next);
};

// Mobile app flow: redirect back via PAYTRAIL_APP_RETURN_URL (HTML page then deep-links into the app)
export const createPaytrailPaymentApp = async (req, res, next) => {
    const appReturnUrl = process.env.PAYTRAIL_APP_RETURN_URL || '';
    if (!appReturnUrl || !appReturnUrl.startsWith('https://')) {
        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            error: 'PAYTRAIL_APP_RETURN_URL missing or not https://'
        });
    }
    return _createPaytrailPaymentInternal(req, res, next, {
        redirectSuccessUrl: appReturnUrl,
        redirectCancelUrl: appReturnUrl
    });
};

/**
 * GET Paytrail app return page. Paytrail redirects here after payment (success or cancel).
 * This page redirects the browser to the mobile app via okazzo:// so the app can verify and show success.
 * Set PAYTRAIL_APP_RETURN_URL to this route (e.g. https://test.okazzo.eu/front/paytrail-app-return).
 */
export const paytrailAppReturnPage = (req, res) => {
    const stamp = req.query.stamp || req.query.STAMP || '';
    const transactionId = req.query.transactionId
        || req.query.CHECKOUT_TRANSACTION_ID
        || req.query.checkout_transaction_id
        || req.query['checkout-transaction-id']
        || req.query['CHECKOUT-TRANSACTION-ID']
        || '';
    const status = req.query.status
        || req.query['checkout-status']
        || req.query['CHECKOUT-STATUS']
        || (req.query.cancel !== undefined ? 'cancel' : 'ok');
    const params = new URLSearchParams();
    if (stamp) params.set('stamp', stamp);
    if (transactionId) params.set('transactionId', transactionId);
    params.set('status', status);
    const deepLink = `okazzo://paytrail-return?${params.toString()}`;
    const escaped = deepLink.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escaped}"></head><body><p>Returning to app…</p><p><a href="${escaped}">Open Okazzo app</a></p></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
};

// Handle Paytrail payment failure/cancellation
// Releases seat reservations and cleans up payment data
// Includes idempotency checks and security validation
export const handlePaytrailPaymentFailure = async (req, res, next) => {
    try {
        // Security Layer 1: Request size validation
        validateRequestSize(req.body);

        const {
            stamp,
            transactionId,
            status, // 'fail' or 'cancel'
            eventId,
            placeIds,
            sessionId,
            email,
            nonce, // Nonce for duplicate submission protection
            checkoutToken
        } = req.body;

        // Security Layer 2: Validate required fields
        if (!stamp || !transactionId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Missing required fields: stamp and transactionId are required'
            });
        }

        // Security Layer 3: Validate status
        if (status && status !== 'fail' && status !== 'cancel') {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Invalid status. Must be "fail" or "cancel"'
            });
        }

        // Security Layer 4: Validate stamp and transactionId format
        if (typeof stamp !== 'string' || stamp.length < 10 || stamp.length > 200) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Invalid stamp format'
            });
        }

        if (typeof transactionId !== 'string' || transactionId.length < 10 || transactionId.length > 200) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Invalid transactionId format'
            });
        }

        const redisClient = (await import('../src/redis/client.js')).default;
        const clientId = getClientIdentifier(req);

        // Security Layer 5: Verify stamp exists in Redis and matches transactionId
        // This ensures the failure request is legitimate
        const paymentKey = `paytrail_payment:${stamp}`;
        const redisPaymentData = await redisClient.get(paymentKey);

        if (redisPaymentData) {
            try {
                const paymentData = JSON.parse(redisPaymentData);
                // Verify transactionId matches
                if (paymentData.transactionId && paymentData.transactionId !== transactionId) {
                    console.warn('[handlePaytrailPaymentFailure] TransactionId mismatch:', {
                        stamp,
                        providedTransactionId: transactionId,
                        storedTransactionId: paymentData.transactionId,
                        clientId
                    });
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        error: 'TransactionId mismatch'
                    });
                }
                // Verify eventId matches if provided
                if (eventId && paymentData.eventId && paymentData.eventId !== eventId) {
                    console.warn('[handlePaytrailPaymentFailure] EventId mismatch:', {
                        stamp,
                        providedEventId: eventId,
                        storedEventId: paymentData.eventId,
                        clientId
                    });
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        error: 'EventId mismatch'
                    });
                }
                // Use stored email if not provided (for security)
                const verifiedEmail = email || paymentData.email;
                const verifiedEventId = eventId || paymentData.eventId;
                const verifiedPlaceIds = placeIds || paymentData.placeIds || [];
                const verifiedSessionId = sessionId || paymentData.sessionId || null;
                const verifiedCheckoutToken = req.body.checkoutToken || paymentData.checkoutToken || null;

                console.log('[handlePaytrailPaymentFailure] Payment failure verified:', {
                    stamp,
                    transactionId,
                    status,
                    verifiedEventId,
                    verifiedPlaceIdsCount: verifiedPlaceIds.length,
                    hasEmail: !!verifiedEmail,
                    clientId
                });

                // IDEMPOTENCY: Check if failure has already been processed
                const failureKey = `paytrail_failure_processed:${stamp}`;
                const alreadyProcessed = await redisClient.get(failureKey);

                if (alreadyProcessed) {
                    // Already processed - return success (idempotent)
                    const processedData = JSON.parse(alreadyProcessed);
                    console.log('[handlePaytrailPaymentFailure] Already processed (idempotent):', {
                        stamp,
                        transactionId,
                        processedAt: processedData.timestamp,
                        clientId
                    });
                    return res.status(consts.HTTP_STATUS_OK).json({
                        success: true,
                        message: 'Payment failure already handled',
                        data: {
                            released: processedData.released || 0,
                            status: status || 'fail',
                            processedAt: processedData.timestamp
                        }
                    });
                }

                // NONCE VALIDATION - prevent duplicate submissions
                let nonceValid = true;
                if (nonce && typeof nonce === 'string' && nonce.length >= 32) {
                    const nonceKey = `paytrail_failure_nonce:${nonce}`;
                    const nonceValue = JSON.stringify({
                        stamp,
                        transactionId,
                        eventId: verifiedEventId,
                        email: verifiedEmail,
                        timestamp: new Date().toISOString(),
                        clientId: clientId
                    });

                    // Atomically check and set: returns null if key already exists
                    const setResult = await redisClient.set(nonceKey, nonceValue, {
                        NX: true, // Only set if key does not exist
                        EX: 600  // 10 minutes TTL
                    });

                    if (setResult === null) {
                        // Nonce already exists - duplicate submission
                        const existingNonce = await redisClient.get(nonceKey);
                        let existingData = null;
                        try {
                            existingData = existingNonce ? JSON.parse(existingNonce) : null;
                        } catch (e) {
                            // Ignore parse errors
                        }

                        console.warn('[handlePaytrailPaymentFailure] Duplicate submission detected:', {
                            nonce,
                            stamp,
                            transactionId,
                            clientId: clientId,
                            timestamp: new Date().toISOString(),
                            existingData: existingData
                        });

                        // Return success (idempotent) but don't process again
                        return res.status(consts.HTTP_STATUS_OK).json({
                            success: true,
                            message: 'Payment failure already handled',
                            data: {
                                released: 0,
                                status: status || 'fail'
                            }
                        });
                    }
                }

                // Release seat reservations (prefer session-based release for seated checkout)
                let releasedCount = 0;
                if (verifiedEventId && verifiedSessionId && verifiedEmail) {
                    try {
                        const { released } = await seatReservationService.releaseReservationsBySession(
                            verifiedEventId,
                            verifiedSessionId,
                            verifiedEmail
                        );
                        releasedCount = released;
                        console.log(`[handlePaytrailPaymentFailure] Released ${releasedCount} seat reservations by session for event ${verifiedEventId}`);
                    } catch (reservationError) {
                        console.error('[handlePaytrailPaymentFailure] Error releasing reservations by session:', reservationError);
                    }
                } else if (verifiedEventId && verifiedPlaceIds && Array.isArray(verifiedPlaceIds) && verifiedPlaceIds.length > 0) {
                    try {
                        const seatReservationService = (await import('../src/services/seatReservationService.js')).default;

                        // Security: Verify reservations belong to this email before releasing
                        if (verifiedEmail) {
                            for (const placeId of verifiedPlaceIds) {
                                const reservationSessionId = await seatReservationService.getReservation(
                                    verifiedEventId,
                                    placeId,
                                    verifiedEmail
                                );
                                if (!reservationSessionId) {
                                    console.warn('[handlePaytrailPaymentFailure] No reservation found for placeId:', {
                                        eventId: verifiedEventId,
                                        placeId,
                                        email: verifiedEmail
                                    });
                                }
                            }
                        }

                        // Release reservations (with email for security)
                        releasedCount = await seatReservationService.releaseReservations(
                            verifiedEventId,
                            verifiedPlaceIds,
                            verifiedEmail || undefined
                        );

                        console.log(`[handlePaytrailPaymentFailure] Released ${releasedCount} seat reservations for event ${verifiedEventId}`);
                    } catch (reservationError) {
                        console.error('[handlePaytrailPaymentFailure] Error releasing reservations:', reservationError);
                        // Don't fail the entire operation if reservation release fails
                    }
                }

                if (verifiedCheckoutToken) {
                    try {
                        await deleteSeatCheckoutSession(verifiedCheckoutToken);
                    } catch (checkoutSessionError) {
                        console.error('[handlePaytrailPaymentFailure] Error deleting checkout session:', checkoutSessionError);
                    }
                }

                // Mark as processed (idempotency)
                const processedData = {
                    stamp,
                    transactionId,
                    eventId: verifiedEventId,
                    released: releasedCount,
                    timestamp: new Date().toISOString(),
                    clientId: clientId
                };
                await redisClient.set(failureKey, JSON.stringify(processedData), {
                    EX: 3600 // 1 hour TTL
                });

                // Clean up Redis payment data
                await redisClient.del(paymentKey);
                console.log(`[handlePaytrailPaymentFailure] Cleaned up Redis payment data for stamp: ${stamp}`);

                return res.status(consts.HTTP_STATUS_OK).json({
                    success: true,
                    message: 'Payment failure handled successfully',
                    data: {
                        released: releasedCount,
                        status: status || 'fail'
                    }
                });
            } catch (parseError) {
                console.error('[handlePaytrailPaymentFailure] Error parsing Redis payment data:', parseError);
                // Continue with basic cleanup even if parse fails
            }
        } else {
            // Payment data not found in Redis (may have expired or already been cleaned up)
            // Check if failure was already processed
            const failureKey = `paytrail_failure_processed:${stamp}`;
            const alreadyProcessed = await redisClient.get(failureKey);

            if (alreadyProcessed) {
                const processedData = JSON.parse(alreadyProcessed);
                console.log('[handlePaytrailPaymentFailure] Already processed (idempotent, no payment data):', {
                    stamp,
                    transactionId,
                    processedAt: processedData.timestamp
                });
                return res.status(consts.HTTP_STATUS_OK).json({
                    success: true,
                    message: 'Payment failure already handled',
                    data: {
                        released: processedData.released || 0,
                        status: status || 'fail',
                        processedAt: processedData.timestamp
                    }
                });
            }

            // No payment data and not processed - likely expired or invalid
            console.warn('[handlePaytrailPaymentFailure] Payment data not found in Redis:', {
                stamp,
                transactionId,
                clientId
            });

            // Still try to release reservations if provided (defensive)
            if (eventId && sessionId && email) {
                try {
                    const { released } = await seatReservationService.releaseReservationsBySession(
                        eventId,
                        sessionId,
                        email
                    );
                    console.log(`[handlePaytrailPaymentFailure] Released ${released} reservations by session (no payment data found)`);
                    if (checkoutToken) {
                        await deleteSeatCheckoutSession(checkoutToken);
                    }

                    // Mark as processed
                    const failureKey = `paytrail_failure_processed:${stamp}`;
                    await redisClient.set(failureKey, JSON.stringify({
                        stamp,
                        transactionId,
                        eventId,
                        released,
                        timestamp: new Date().toISOString(),
                        clientId
                    }), { EX: 3600 });

                    return res.status(consts.HTTP_STATUS_OK).json({
                        success: true,
                        message: 'Payment failure handled (session release)',
                        data: { released, status: status || 'fail' }
                    });
                } catch (reservationError) {
                    console.error('[handlePaytrailPaymentFailure] Error releasing reservations by session (no payment data):', reservationError);
                }
            }

            if (eventId && placeIds && Array.isArray(placeIds) && placeIds.length > 0 && email) {
                try {
                    const seatReservationService = (await import('../src/services/seatReservationService.js')).default;
                    const releasedCount = await seatReservationService.releaseReservations(
                        eventId,
                        placeIds,
                        email
                    );
                    console.log(`[handlePaytrailPaymentFailure] Released ${releasedCount} reservations (no payment data found)`);

                    // Mark as processed
                    const failureKey = `paytrail_failure_processed:${stamp}`;
                    await redisClient.set(failureKey, JSON.stringify({
                        stamp,
                        transactionId,
                        eventId,
                        released: releasedCount,
                        timestamp: new Date().toISOString(),
                        clientId: clientId
                    }), { EX: 3600 });

                    return res.status(consts.HTTP_STATUS_OK).json({
                        success: true,
                        message: 'Payment failure handled (no payment data found)',
                        data: {
                            released: releasedCount,
                            status: status || 'fail'
                        }
                    });
                } catch (reservationError) {
                    console.error('[handlePaytrailPaymentFailure] Error releasing reservations (no payment data):', reservationError);
                }
            }

            return res.status(consts.HTTP_STATUS_OK).json({
                success: true,
                message: 'Payment failure handled (no payment data found)',
                data: {
                    released: 0,
                    status: status || 'fail'
                }
            });
        }
    } catch (err) {
        error('Error handling Paytrail payment failure:', err);
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            error: err.message || 'Failed to handle payment failure'
        });
    }
};

// Verify Paytrail payment by stamp and return ticket if payment was successful
// If webhook hasn't processed yet, verify payment status directly with Paytrail API
export const verifyPaytrailPayment = async (req, res, next) => {
    let lockKey = null;
    try {
        console.log('=== verifyPaytrailPayment CALLED ===');
        console.log('Body:', JSON.stringify(req.body));

        // Get Paytrail params from body (sent by client after redirect)
        const {
            stamp,
            transactionId,
            status,
            // Checkout data from client (needed to create ticket)
            eventId,
            email,
            customerName,
            quantity,
            ticketTypeId,
            seats,
            amount,
            currency,
            // Pricing breakdown from client
            basePrice,
            serviceFee,
            vatRate,
            vatAmount,
            serviceTax,
            serviceTaxAmount,
            entertainmentTax,
            entertainmentTaxAmount,
            orderFee,
            orderFeeServiceTax,
            totalBasePrice,
            totalServiceFee,
            country,
            fullName,
            seatTickets, // Array of {placeId, ticketId, ticketName} for multiple ticket types
            placeIds, // Explicit placeIds array (may be sent separately from seats)
            sectionSelections, // Standing/area: [{ sectionId?, sectionName?, quantity }] — must reach createTicketFromPaytrailPayment
            sessionId, // Seat reservation session (optional; stored in Redis at create time when sent)
            nonce, // Nonce for duplicate submission protection,
            locale // Locale for the payment
        } = req.body;

        if (!stamp || !transactionId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Missing stamp or transactionId'
            });
        }

        console.log(`[verifyPaytrailPayment] stamp=${stamp}, transactionId=${transactionId}, status=${status}`);
        console.log('[verifyPaytrailPayment] Request body data:', {
            hasPlaceIds: !!placeIds,
            placeIds: placeIds,
            hasSeats: !!seats,
            seats: seats,
            hasSeatTickets: !!seatTickets,
            seatTicketsLength: seatTickets ? (Array.isArray(seatTickets) ? seatTickets.length : 'not array') : 0,
            eventId: eventId
        });

        // 0. NONCE VALIDATION - prevent duplicate form submissions
        if (nonce && typeof nonce === 'string' && nonce.length >= 32) {
            const nonceKey = `paytrail_verify_nonce:${nonce}`;
            const clientId = getClientIdentifier(req);
            const nonceValue = JSON.stringify({
                stamp,
                transactionId,
                eventId,
                email,
                timestamp: new Date().toISOString(),
                clientId: clientId
            });

            // Atomically check and set: returns null if key already exists, 'OK' if set successfully
            const setResult = await redisClient.set(nonceKey, nonceValue, {
                NX: true, // Only set if key does not exist
                EX: 600  // 10 minutes TTL (same as payment data)
            });

            if (setResult === null) {
                // Nonce already exists - this is a duplicate submission
                const existingNonce = await redisClient.get(nonceKey);
                let existingData = null;
                try {
                    existingData = existingNonce ? JSON.parse(existingNonce) : null;
                } catch (e) {
                    // Ignore parse errors
                }

                console.warn('[verifyPaytrailPayment] Duplicate verification submission detected:', {
                    nonce,
                    stamp,
                    transactionId,
                    eventId,
                    email,
                    clientId: clientId,
                    timestamp: new Date().toISOString(),
                    existingData: existingData
                });

                // Check if ticket was already created (idempotency)
                let existingTicket = await Ticket.genericSearch({ paytrailStamp: stamp });
                if (!existingTicket && transactionId) {
                    existingTicket = await Ticket.genericSearch({ paytrailTransactionId: transactionId });
                }

                if (existingTicket) {
                    // Ticket already exists - return it (idempotent response)
                    console.log(`[verifyPaytrailPayment] Ticket already exists for duplicate nonce: ${existingTicket._id}`);
                    existingTicket = await Ticket.getTicketById(existingTicket._id);
                    const eventForTicket = await Event.getEventById(
                        existingTicket?.ticketInfo?.eventId || existingTicket?.event
                    );
                    if (eventForTicket) {
                        existingTicket = await ticketMaster.prepareTicketForClientResponse(eventForTicket, existingTicket);
                    }
                    return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket: existingTicket });
                }

                // Nonce used but no ticket - reject duplicate submission
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    error: 'Duplicate submission',
                    message: 'This payment verification has already been submitted. Please refresh the page if you need to check your ticket status.'
                });
            }

            // Nonce successfully stored - this is a new, valid submission
            console.log(`[verifyPaytrailPayment] Nonce validated and stored: ${nonce}`);
        } else if (nonce) {
            // Nonce provided but invalid format - log warning but don't block (backward compatibility)
            console.warn('[verifyPaytrailPayment] Invalid nonce format (too short or wrong type):', {
                nonce,
                length: nonce?.length,
                type: typeof nonce
            });
        }

        // 1. IDEMPOTENCY CHECK WITH REDIS LOCK - prevent race conditions from multiple simultaneous requests
        lockKey = `paytrail_verify_lock:${stamp}`;
        const lockValue = transactionId;
        const lockTTL = 30; // 30 seconds lock

        // Try to acquire lock (SET with NX - only set if not exists)
        const lockAcquired = await redisClient.set(lockKey, lockValue, { EX: lockTTL, NX: true });

        if (lockAcquired === null) {
            // Another request is processing this payment - wait a bit and check if ticket was created
            console.log(`[verifyPaytrailPayment] Lock already exists, waiting for other request to complete...`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

            // Check if ticket was created by the other request
            let ticket = await Ticket.genericSearch({ paytrailStamp: stamp });
            if (!ticket) {
                ticket = await Ticket.genericSearch({ paytrailTransactionId: transactionId });
            }

            if (ticket) {
                console.log(`[verifyPaytrailPayment] Ticket created by another request: ${ticket._id}`);
                ticket = await Ticket.getTicketById(ticket._id);
                const eventForTicket = await Event.getEventById(ticket?.ticketInfo?.eventId || ticket?.event);
                if (eventForTicket) {
                    ticket = await ticketMaster.prepareTicketForClientResponse(eventForTicket, ticket);
                }
                return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket });
            }

            // Still no ticket - return error (shouldn't happen, but handle gracefully)
            return res.status(consts.HTTP_STATUS_CONFLICT).json({
                error: 'Payment verification in progress',
                message: 'Another request is currently processing this payment. Please wait a moment and refresh.'
            });
        }

        // Lock acquired - proceed with verification
        try {
            // Check if ticket already exists (double-check after acquiring lock)
            let ticket = await Ticket.genericSearch({ paytrailStamp: stamp });
            if (!ticket) {
                ticket = await Ticket.genericSearch({ paytrailTransactionId: transactionId });
            }

            if (ticket) {
                console.log(`[verifyPaytrailPayment] Ticket already exists: ${ticket._id}`);
                ticket = await Ticket.getTicketById(ticket._id);
                const eventForTicket = await Event.getEventById(ticket?.ticketInfo?.eventId || ticket?.event);
                if (eventForTicket) {
                    ticket = await ticketMaster.prepareTicketForClientResponse(eventForTicket, ticket);
                }
                return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket });
            }

            // 2. VERIFY PAYMENT STATUS - Only fetch from Paytrail API if status not provided in redirect params
        // Unlike Stripe's payment intent, Paytrail doesn't have a "pending" state - payment happens on their side
        // We already validated the amount at creation time and stored it in Redis, so we don't need to fetch for amount
        let paymentStatus = status;
        let paytrailApiAmount = null; // Only used for verification if API is called

        if (!paymentStatus || paymentStatus !== 'ok') {
            // Status not provided or not 'ok' - fetch from Paytrail API to verify
            console.log(`[verifyPaytrailPayment] Status not 'ok' or missing, fetching from Paytrail API...`);
            const paytrailService = (await import('../services/paytrailService.js')).default;
            try {
                const paytrailPayment = await paytrailService.getPayment(transactionId);
                paymentStatus = paytrailPayment.status;
                paytrailApiAmount = paytrailPayment.amount; // May be undefined if API doesn't return it
                console.log(`[verifyPaytrailPayment] Paytrail API response:`, {
                    status: paymentStatus,
                    amount: paytrailApiAmount,
                    currency: paytrailPayment.currency
                });
            } catch (apiError) {
                console.error(`[verifyPaytrailPayment] Failed to fetch payment from Paytrail API:`, apiError);
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    error: 'Failed to verify payment with Paytrail',
                    message: 'Could not retrieve payment details from Paytrail. Please try again or contact support.'
                });
            }
        } else {
            console.log(`[verifyPaytrailPayment] Payment status from redirect: ${paymentStatus}`);
        }

        if (paymentStatus !== 'ok') {
            console.error(`[verifyPaytrailPayment] Payment status is not 'ok': ${paymentStatus}`);
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Payment not successful',
                status: paymentStatus,
                message: `Payment status is '${paymentStatus}'. Only successful payments can create tickets.`
            });
        }

        // Payment is confirmed by Paytrail - proceed with ticket creation
        console.log(`[verifyPaytrailPayment] Payment confirmed by Paytrail (status=ok), proceeding with ticket creation`);

        // 3. GET REDIS DATA - This contains the validated amount from createPaytrailPayment (trusted source)
        const paymentKey = `paytrail_payment:${stamp}`;
        const redisDataStr = await redisClient.get(paymentKey);

        let redisData = null;
        let useRedisData = false;

        if (redisDataStr) {
            redisData = JSON.parse(redisDataStr);
            console.log(`[verifyPaytrailPayment] Redis data found, verifying against client data...`);
            console.log('[verifyPaytrailPayment] Redis pricing data:', {
                basePrice: redisData.basePrice,
                serviceFee: redisData.serviceFee,
                vatAmount: redisData.vatAmount,
                amount: redisData.amount
            });

            // Verify Paytrail API amount matches Redis amount (if Paytrail API returned amount)
            if (paytrailApiAmount && redisData.amount) {
                const redisAmount = parseInt(redisData.amount);
                const apiAmount = parseInt(paytrailApiAmount);
                if (redisAmount !== apiAmount) {
                    console.warn(`[verifyPaytrailPayment] Amount mismatch: Redis=${redisAmount}, Paytrail API=${apiAmount}`);
                    // Use Redis amount as it was validated at creation time
                }
            }

            // Verify critical fields from client match Redis (prevent tampering)
            const mismatches = [];
            if (eventId && redisData.eventId !== eventId) {
                mismatches.push(`eventId: redis=${redisData.eventId}, client=${eventId}`);
            }
            if (email && redisData.email.toLowerCase() !== email.toLowerCase()) {
                mismatches.push(`email: redis=${redisData.email}, client=${email}`);
            }
            if (amount && parseInt(redisData.amount) !== parseInt(amount)) {
                mismatches.push(`amount: redis=${redisData.amount}, client=${amount}`);
            }
            if (quantity && parseInt(redisData.quantity) !== parseInt(quantity)) {
                mismatches.push(`quantity: redis=${redisData.quantity}, client=${quantity}`);
            }
            if (ticketTypeId && redisData.ticketId !== ticketTypeId && redisData.ticketTypeId !== ticketTypeId) {
                mismatches.push(`ticketTypeId: redis=${redisData.ticketId || redisData.ticketTypeId}, client=${ticketTypeId}`);
            }

            if (mismatches.length > 0) {
                console.log(`[verifyPaytrailPayment] DATA MISMATCH DETECTED: ${mismatches.join(', ')}`);
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    error: 'Payment data mismatch',
                    message: 'The checkout data does not match the original payment. Possible tampering detected.'
                });
            }

            console.log(`[verifyPaytrailPayment] Client data verified - using Redis data (trusted source)`);
            useRedisData = true;
        } else {
            // Redis missing - could be expired or webhook already processed
            console.log(`[verifyPaytrailPayment] Redis data NOT FOUND for stamp: ${stamp}`);

            // Double-check ticket doesn't exist (webhook might have processed it)
            ticket = await Ticket.genericSearch({ paytrailStamp: stamp });
            if (!ticket && transactionId) {
                ticket = await Ticket.genericSearch({ paytrailTransactionId: transactionId });
            }

            if (ticket) {
                console.log(`[verifyPaytrailPayment] Ticket found (webhook processed) - Redis already deleted`);
                ticket = await Ticket.getTicketById(ticket._id);
                return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket });
            }

            // No Redis and no ticket - need client data as fallback
            // Since Paytrail confirmed payment (status='ok'), we should be more lenient
            // Only require the absolute minimum: eventId and email
            if (!eventId || !email) {
                console.error(`[verifyPaytrailPayment] Missing critical fields: eventId=${!!eventId}, email=${!!email}`);
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    error: 'Payment data expired and missing required fields',
                    message: 'The payment data has expired (10 minute TTL) and required checkout data (eventId, email) is missing. Please initiate a new payment.'
                });
            }

            // For missing fields, we'll use defaults or fetch from event
            // quantity defaults to 1 if not provided
            // ticketTypeId can be null for pricing_configuration mode
            console.log(`[verifyPaytrailPayment] Using client data as fallback (Redis expired but payment verified by Paytrail)`);
            console.log(`[verifyPaytrailPayment] Client data: eventId=${eventId}, email=${email}, quantity=${quantity || 'missing'}, ticketTypeId=${ticketTypeId || 'missing'}`);
            // Will use client data below with defaults for missing fields
        }

        // 4. GET EVENT AND MERCHANT
        const finalEventId = useRedisData ? redisData.eventId : eventId;
        const event = await Event.getEventById(finalEventId);
        if (!event) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: 'Event not found' });
        }

        const merchant = await Merchant.getMerchantById(event.merchant);
        if (!merchant) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: 'Merchant not found' });
        }

        // 4.5. VALIDATE PRICE - Calculate expected price and verify against received amount
        const finalTicketTypeId = useRedisData ? (redisData.ticketId || redisData.ticketTypeId) : (ticketTypeId || null);

        // For pricing_configuration mode, ticketTypeId can be null
        // For ticket_info mode, we need a ticket type
        const isPricingConfiguration = event?.venue?.pricingModel === 'pricing_configuration';
        let ticketType = null;

        if (finalTicketTypeId) {
            ticketType = event.ticketInfo?.find(t => t._id?.toString() === finalTicketTypeId);
            if (!ticketType && !isPricingConfiguration) {
                console.warn(`[verifyPaytrailPayment] Ticket type ${finalTicketTypeId} not found, but payment confirmed - using first ticket or creating dummy ticket`);
                // For pricing_configuration, we'll create a dummy ticket below
                ticketType = event.ticketInfo?.[0]; // Fallback to first ticket
            }
        }

        // For pricing_configuration mode, create a dummy ticket from metadata
        if (isPricingConfiguration && !ticketType) {
            // NOTE: basePrice and serviceFee from client/Redis are ALREADY per-unit values
            // DO NOT divide by quantity - they're per-unit, not totals
            ticketType = {
                _id: null,
                name: 'Seat Selection',
                price: useRedisData ? parseFloat(redisData.basePrice) : (parseFloat(basePrice) || 0),
                serviceFee: useRedisData ? parseFloat(redisData.serviceFee) : (parseFloat(serviceFee) || 0),
                vat: useRedisData ? parseFloat(redisData.vatRate) : parseFloat(vatRate) || 0,
                entertainmentTax: useRedisData ? parseFloat(redisData.entertainmentTax) : parseFloat(entertainmentTax) || 0,
                serviceTax: useRedisData ? parseFloat(redisData.serviceTax) : parseFloat(serviceTax) || 0,
                orderFee: useRedisData ? parseFloat(redisData.orderFee) : parseFloat(orderFee) || 0
            };
            console.log(`[verifyPaytrailPayment] Created dummy ticket for pricing_configuration mode:`, {
                price: ticketType.price,
                serviceFee: ticketType.serviceFee,
                entertainmentTax: ticketType.entertainmentTax,
                serviceTax: ticketType.serviceTax,
                orderFee: ticketType.orderFee,
                source: useRedisData ? 'Redis' : 'client'
            });
        }

        if (!ticketType && !isPricingConfiguration) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                error: 'Ticket type not found',
                message: 'Could not determine ticket type. Please contact support.'
            });
        }

        // Build metadata for price calculation (use Redis data if available, otherwise client data)
        // Use defaults for missing fields when Redis expired
        const finalQuantityForCalc = useRedisData ? parseInt(redisData.quantity) : (parseInt(quantity) || 1);

        // Parse seatTickets if it's a string
        let parsedSeatTickets = [];
        if (useRedisData) {
            parsedSeatTickets = redisData.seatTickets || [];
        } else if (seatTickets) {
            parsedSeatTickets = typeof seatTickets === 'string' ? JSON.parse(seatTickets) : seatTickets;
        }

        const priceCalcMetadata = useRedisData ? {
            ...redisData,
            quantity: redisData.quantity?.toString() || quantity?.toString() || '1',
            placeIds: redisData.placeIds || redisData.seats || [],
            seatTickets: parsedSeatTickets,
            // Ensure total fields are explicitly included for pricing_configuration
            totalBasePrice: redisData.totalBasePrice,
            totalServiceFee: redisData.totalServiceFee,
            entertainmentTaxAmount: redisData.entertainmentTaxAmount || redisData.vatAmount,
            serviceTaxAmount: redisData.serviceTaxAmount,
            orderFee: redisData.orderFee,
            orderFeeServiceTax: redisData.orderFeeServiceTax
        } : {
            eventId,
            email,
            quantity: quantity?.toString() || '1',
            ticketId: ticketTypeId || null,
            placeIds: seats || [],
            seatTickets: parsedSeatTickets,
            basePrice,
            serviceFee,
            vatRate,
            vatAmount,
            serviceTax,
            serviceTaxAmount,
            entertainmentTax,
            entertainmentTaxAmount,
            orderFee,
            orderFeeServiceTax,
            // Explicitly include total fields for pricing_configuration calculation
            totalBasePrice,
            totalServiceFee,
            country,
            fullName
        };

        console.log('[verifyPaytrailPayment] priceCalcMetadata:', {
            hasTotalBasePrice: priceCalcMetadata.totalBasePrice !== undefined,
            hasTotalServiceFee: priceCalcMetadata.totalServiceFee !== undefined,
            totalBasePrice: priceCalcMetadata.totalBasePrice,
            totalServiceFee: priceCalcMetadata.totalServiceFee,
            entertainmentTaxAmount: priceCalcMetadata.entertainmentTaxAmount,
            serviceTaxAmount: priceCalcMetadata.serviceTaxAmount,
            orderFee: priceCalcMetadata.orderFee,
            orderFeeServiceTax: priceCalcMetadata.orderFeeServiceTax,
            quantity: priceCalcMetadata.quantity
        });

        // Calculate expected price using the same logic as createPaytrailPayment
        const expectedPrice = calculateExpectedPrice(ticketType, event, finalQuantityForCalc, priceCalcMetadata);

        // Determine which amount to use for validation (priority: Redis > Paytrail API > client)
        // Redis amount was validated at creation time, so it's the most trusted
        let amountToValidate;
        if (useRedisData && redisData.amount) {
            amountToValidate = parseInt(redisData.amount) / 100; // Redis amount in dollars
            console.log(`[verifyPaytrailPayment] Using Redis amount for validation: ${amountToValidate}`);
        } else if (paytrailApiAmount) {
            amountToValidate = parseInt(paytrailApiAmount) / 100; // Paytrail API amount in dollars
            console.log(`[verifyPaytrailPayment] Using Paytrail API amount for validation: ${amountToValidate}`);
        } else {
            amountToValidate = parseInt(amount || 0) / 100; // Client amount in dollars (fallback)
            console.log(`[verifyPaytrailPayment] Using client amount for validation: ${amountToValidate}`);
        }

        // Price validation at verification time is for LOGGING/MONITORING only, NOT blocking
        // The actual price validation happened at createPaytrailPayment BEFORE payment was created
        // By this point, Paytrail has already charged the customer - we MUST create the ticket
        //
        // Unlike Stripe (which validates before capture), Paytrail payment is complete when user returns
        // Blocking here would mean: customer paid but gets no ticket = worst outcome
        try {
            validatePriceCalculation(amountToValidate, expectedPrice, 0.02);
            console.log(`[verifyPaytrailPayment] Price validation passed: Expected=${expectedPrice.totalAmount}, Received=${amountToValidate}`);
        } catch (priceError) {
            // LOG the mismatch but DO NOT block ticket creation
            // The payment was already validated at createPaytrailPayment before Paytrail processed it
            console.warn(`[verifyPaytrailPayment] ⚠️ PRICE MISMATCH (logging only, not blocking):`, {
                expected: expectedPrice.totalAmount,
                received: amountToValidate,
                difference: Math.abs(expectedPrice.totalAmount - amountToValidate),
                error: priceError.message,
                stamp: stamp,
                transactionId: transactionId,
                eventId: finalEventId,
                email: useRedisData ? redisData.email : email,
                // This may indicate: expired Redis + wrong client data, or a bug in price calculation
                // Either way, customer paid successfully so we create the ticket
                note: 'Payment already completed by Paytrail. Creating ticket anyway to honor the payment.'
            });
            // Continue with ticket creation - payment is already done!
        }

        // 5. BUILD PAYMENT DATA - prefer Redis (trusted), fallback to client data
        console.log(`[verifyPaytrailPayment] Creating ticket for event=${finalEventId}`);

        const normalizePaytrailSectionSelections = (raw) => {
            if (!raw) return [];
            if (Array.isArray(raw)) return raw;
            if (typeof raw === 'string') {
                const t = raw.trim();
                if (!t || t === '[]') return [];
                try {
                    const p = JSON.parse(t);
                    return Array.isArray(p) ? p : [];
                } catch {
                    return [];
                }
            }
            return [];
        };

        // Redis already holds sectionSelections from createPaytrailPayment; verify must forward them to
        // createTicketFromPaytrailPayment or areaSoldCounts / sold manifest never updates.
        const finalSectionSelections = useRedisData
            ? normalizePaytrailSectionSelections(redisData.sectionSelections)
            : normalizePaytrailSectionSelections(sectionSelections);

        const finalSessionId = useRedisData
            ? (redisData.sessionId && String(redisData.sessionId).trim()) || null
            : (sessionId && String(sessionId).trim()) || null;

        // Get ticket type info for ticket name (already found above)
        const defaultTicketName = ticketType?.name || 'Standard Ticket';

        const paymentData = {
            eventId: finalEventId,
            merchantId: merchant._id.toString(),
            externalMerchantId: useRedisData ? (redisData.externalMerchantId || merchant.merchantId) : merchant.merchantId,
            eventName: useRedisData ? (redisData.eventName || event.eventTitle || event.eventName) : (event.eventTitle || event.eventName),
            ticketName: useRedisData ? (redisData.ticketName || defaultTicketName) : defaultTicketName,
            ticketId: finalTicketTypeId,
            email: useRedisData ? redisData.email : email,
            customerName: useRedisData ? (redisData.customerName || redisData.fullName || redisData.email.split('@')[0]) : (customerName || email.split('@')[0]),
            quantity: useRedisData ? parseInt(redisData.quantity) : parseInt(quantity),
            ticketTypeId: finalTicketTypeId,
            seats: useRedisData ? (redisData.seats || redisData.placeIds || []) : (seats || []),
            // Use validated amount (Redis > Paytrail API > client)
            amount: useRedisData ? parseInt(redisData.amount) : (paytrailApiAmount ? parseInt(paytrailApiAmount) : parseInt(amount || 0)),
            currency: (useRedisData ? (redisData.currency || 'EUR') : (currency || 'EUR')),
            isShopInShop: useRedisData ? (redisData.isShopInShop || false) : false,
            subMerchantId: useRedisData ? (redisData.subMerchantId || merchant.paytrailSubMerchantId) : (merchant.paytrailSubMerchantId || null),
            commissionRate: useRedisData ? (redisData.commissionRate || merchant.commissionRate) : (merchant.commissionRate || parseFloat(process.env.PAYTRAIL_PLATFORM_COMMISSION || '5')),
            locale: locale ||'en-US',
            // Pricing breakdown fields (from Redis first, then client request, then undefined)
            basePrice: useRedisData ? (redisData.basePrice || parseFloat(basePrice)) : (basePrice ? parseFloat(basePrice) : undefined),
            serviceFee: useRedisData ? (redisData.serviceFee || parseFloat(serviceFee)) : (serviceFee ? parseFloat(serviceFee) : undefined),
            vatRate: useRedisData ? (redisData.vatRate || parseFloat(vatRate)) : (vatRate ? parseFloat(vatRate) : undefined),
            vatAmount: useRedisData ? (redisData.vatAmount || parseFloat(vatAmount)) : (vatAmount ? parseFloat(vatAmount) : undefined),
            serviceTax: useRedisData ? (redisData.serviceTax || parseFloat(serviceTax)) : (serviceTax ? parseFloat(serviceTax) : undefined),
            serviceTaxAmount: useRedisData ? (redisData.serviceTaxAmount || parseFloat(serviceTaxAmount)) : (serviceTaxAmount ? parseFloat(serviceTaxAmount) : undefined),
            entertainmentTax: useRedisData ? (redisData.entertainmentTax || parseFloat(entertainmentTax)) : (entertainmentTax ? parseFloat(entertainmentTax) : undefined),
            entertainmentTaxAmount: useRedisData ? (redisData.entertainmentTaxAmount || parseFloat(entertainmentTaxAmount)) : (entertainmentTaxAmount ? parseFloat(entertainmentTaxAmount) : undefined),
            orderFee: useRedisData ? (redisData.orderFee || parseFloat(orderFee)) : (orderFee ? parseFloat(orderFee) : undefined),
            orderFeeServiceTax: useRedisData ? (redisData.orderFeeServiceTax || parseFloat(orderFeeServiceTax)) : (orderFeeServiceTax ? parseFloat(orderFeeServiceTax) : undefined),
            totalBasePrice: useRedisData ? (redisData.totalBasePrice || parseFloat(totalBasePrice)) : (totalBasePrice ? parseFloat(totalBasePrice) : undefined),
            totalServiceFee: useRedisData ? (redisData.totalServiceFee || parseFloat(totalServiceFee)) : (totalServiceFee ? parseFloat(totalServiceFee) : undefined),
            country: useRedisData ? (redisData.country || country) : (country || undefined),
            fullName: useRedisData ? (redisData.fullName || fullName) : (fullName || undefined),
            placeIds: useRedisData ? (redisData.placeIds || []) : (placeIds || seats || []),
            // Include seatTickets for proper display (has ticketName with human-readable format)
            seatTickets: useRedisData ? (redisData.seatTickets || []) : (parsedSeatTickets || []),
            sectionSelections: finalSectionSelections,
            sessionId: finalSessionId,
            couponCode: useRedisData ? redisData.couponCode : req.body.couponCode,
            couponId: useRedisData ? redisData.couponId : req.body.couponId,
            couponDiscountAmount: useRedisData
                ? redisData.couponDiscountAmount
                : req.body.couponDiscountAmount,
            catalogBaseSubtotal: useRedisData
                ? redisData.catalogBaseSubtotal
                : req.body.catalogBaseSubtotal,
            checkoutToken: useRedisData
                ? (redisData.checkoutToken || null)
                : (req.body.checkoutToken || null),
            checkoutHostname: useRedisData
                ? (redisData.checkoutHostname || extractCheckoutHostname({ req }))
                : extractCheckoutHostname({ req }),
        };

        console.log('[verifyPaytrailPayment] Payment data being passed to createTicketFromPaytrailPayment:', {
            useRedisData,
            placeIdsFromRedis: useRedisData ? redisData.placeIds : null,
            placeIdsFromRequest: placeIds,
            seatsFromRequest: seats,
            finalPlaceIds: paymentData.placeIds,
            finalSeats: paymentData.seats,
            eventId: paymentData.eventId,
            hasSeatTickets: !!(paymentData.seatTickets && paymentData.seatTickets.length > 0),
            sectionSelectionsCount: finalSectionSelections.length,
            hasSessionId: !!finalSessionId
        });

        const paytrailWebhook = await import('./paytrail.webhook.js');
        try {
            ticket = await paytrailWebhook.createTicketFromPaytrailPayment(paymentData, transactionId, stamp);
        } catch (ticketError) {
            if (ticketError?.code === 'SEATS_ALREADY_SOLD') {
                ticket = await Ticket.genericSearch({ paytrailStamp: stamp });
                if (!ticket && transactionId) {
                    ticket = await Ticket.genericSearch({ paytrailTransactionId: transactionId });
                }
                if (ticket) {
                    console.log(`[verifyPaytrailPayment] Ticket found after seat conflict: ${ticket._id}`);
                    ticket = await Ticket.getTicketById(ticket._id);
                    return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket });
                }
                error('[verifyPaytrailPayment] Payment confirmed but seats unavailable', {
                    stamp,
                    transactionId,
                    email: paymentData.email,
                    placeIds: paymentData.placeIds,
                });
                return res.status(consts.HTTP_STATUS_CONFLICT).json({
                    success: false,
                    error: 'SEATS_ALREADY_SOLD',
                    message: 'Payment was received but these seats are no longer available. Please contact support for a refund.',
                    requiresRefund: true,
                });
            }
            throw ticketError;
        }

        if (!ticket) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                error: 'Failed to create ticket'
            });
        }

        console.log(`[verifyPaytrailPayment] Ticket created: ${ticket._id}`);

        // Consume presale token (one-time use) if present (from Redis payload or client body fallback)
        const presaleTokenToConsume = (useRedisData && redisData.presaleToken) ? redisData.presaleToken : (req.body.presaleToken || null);
        if (presaleTokenToConsume && typeof presaleTokenToConsume === 'string') {
            const consumed = await consumePresaleToken(redisClient, presaleTokenToConsume);
            if (consumed) {
                info('[verifyPaytrailPayment] Presale token consumed after successful payment');
            }
        }

        const couponCode = useRedisData ? redisData.couponCode : req.body.couponCode;
        const couponId = useRedisData ? redisData.couponId : req.body.couponId;
        const couponDiscountAmount = useRedisData ? redisData.couponDiscountAmount : req.body.couponDiscountAmount;
        if (couponCode) {
            try {
                const redeemResult = await Event.decrementCouponUsesLeft(finalEventId, couponCode);
                if (redeemResult.ok && event?.externalMerchantId && event?.externalEventId) {
                    await publishDiscountCodeRedeemed({
                        externalMerchantId: event.externalMerchantId,
                        externalEventId: String(event.externalEventId),
                        discountCodeId: couponId,
                        paymentReference: stamp || transactionId,
                        email: paymentData.email,
                        discountAmount: couponDiscountAmount
                    });
                }
            } catch (couponErr) {
                error('[verifyPaytrailPayment] Coupon redeem error (non-blocking)', couponErr);
            }
        }

        // Update merchant stats
        await paytrailWebhook.updateMerchantPaytrailStats(merchant._id, paymentData.amount / 100);

        // Delete Redis entry if it exists (ticket created, no longer needed)
        if (useRedisData) {
            await redisClient.del(paymentKey);
            console.log(`[verifyPaytrailPayment] Redis data deleted after ticket creation`);
        } else {
            console.log(`[verifyPaytrailPayment] Redis was already expired/missing, used client data fallback`);
        }

            // Return populated ticket
            ticket = await Ticket.getTicketById(ticket._id);
            ticket = await ticketMaster.prepareTicketForClientResponse(event, ticket);
            return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket });

        } finally {
            // Always release the lock, even if there was an error
            await redisClient.del(lockKey).catch(err => {
                console.warn(`[verifyPaytrailPayment] Failed to release lock: ${err.message}`);
            });
        }

    } catch (err) {
        console.error('Error verifying Paytrail payment:', err);
        if (lockKey) {
            await redisClient.del(lockKey).catch(() => {});
        }
        if (err?.code === 'SEATS_ALREADY_SOLD') {
            return res.status(consts.HTTP_STATUS_CONFLICT).json({
                success: false,
                error: 'SEATS_ALREADY_SOLD',
                message: err.message || 'One or more seats are already sold',
                requiresRefund: true,
            });
        }
        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
            error: err.message
        });
    }
}

const _createNabilPaymentInternal = async (req, res, { redirectSuccessUrl, redirectCancelUrl } = {}) => {
    try {
        validateRequestSize(req.body);
        const { amount, currency, metadata, paymentProvider } = req.body;

        if (paymentProvider !== 'nabil') {
            throw new Error('Invalid payment provider');
        }

        const validatedData = validatePaymentRequest(req.body);
        const parsedMetadata = { ...validatedData.metadata, paymentProvider: 'nabil' };
        const { merchant, event, ticket } = await validateMerchantAndEvent(parsedMetadata);
        if (!assertSiloEventAccess(req, res, event)) return;

        const v1BlockReason = assertDualPaymentV1Allowed({ merchant, event, metadata: parsedMetadata });
        if (v1BlockReason) {
            throw new Error(v1BlockReason);
        }

        if (!isDualPaymentMerchant(merchant)) {
            throw new Error('Nabil payments are not enabled for this merchant');
        }

        const expectedPrice = calculateExpectedPrice(ticket, event, parseInt(parsedMetadata.quantity, 10), parsedMetadata);
        validatePriceCalculation(amount / 100, expectedPrice);

        if (amount === 0 && roundMoney(expectedPrice.totalAmount) === 0) {
            return await completeZeroAmountCheckout(req, res, {
                metadata,
                parsedMetadata,
                event,
                currency,
                merchant
            });
        }

        const nabilService = (await import('../services/nabilPaymentService.js')).default;
        if (!nabilService.isConfigured()) {
            throw new Error('Nabil EPG is not configured');
        }

        const nabilPayment = await nabilService.createPayment({
            amount,
            currency: (currency || 'NPR').toUpperCase(),
            merchantId: parsedMetadata.externalMerchantId || merchant.merchantId,
            eventId: parsedMetadata.eventId,
            ticketId: parsedMetadata.ticketId,
            customer: {
                email: parsedMetadata.email,
                name: parsedMetadata.fullName || parsedMetadata.email
            },
            redirectSuccessUrl: req.body.redirectSuccessUrl || redirectSuccessUrl,
            redirectCancelUrl: req.body.redirectCancelUrl || redirectCancelUrl
        });

        const paymentKey = `nabil_payment:${nabilPayment.stamp}`;
        const redisPaymentData = {
            stamp: nabilPayment.stamp,
            transactionId: nabilPayment.transactionId,
            amount,
            currency: (currency || 'NPR').toUpperCase(),
            commission: nabilPayment.commission,
            merchantId: parsedMetadata.merchantId,
            externalMerchantId: parsedMetadata.externalMerchantId || merchant.merchantId,
            eventId: parsedMetadata.eventId,
            eventName: parsedMetadata.eventName,
            ticketId: parsedMetadata.ticketId,
            ticketName: parsedMetadata.ticketName,
            email: parsedMetadata.email,
            fullName: parsedMetadata.fullName,
            phone: parsedMetadata.phone || '',
            quantity: parseInt(parsedMetadata.quantity, 10),
            basePrice: parsedMetadata.basePrice,
            serviceFee: parsedMetadata.serviceFee,
            vatRate: parsedMetadata.vatRate,
            vatAmount: parsedMetadata.vatAmount,
            serviceTax: parsedMetadata.serviceTax,
            serviceTaxAmount: parsedMetadata.serviceTaxAmount,
            orderFee: parsedMetadata.orderFee,
            orderFeeServiceTax: parsedMetadata.orderFeeServiceTax,
            totalBasePrice: parsedMetadata.totalBasePrice,
            totalServiceFee: parsedMetadata.totalServiceFee,
            country: parsedMetadata.country,
            marketingOptIn: parsedMetadata.marketingOptIn,
            nonce: parsedMetadata.nonce,
            locale: parsedMetadata.locale || 'en-US',
            paymentProvider: 'nabil'
        };

        await redisClient.set(paymentKey, JSON.stringify(redisPaymentData), { EX: 600 });

        res.status(consts.HTTP_STATUS_OK).json({
            paymentUrl: nabilPayment.href,
            transactionId: nabilPayment.transactionId,
            stamp: nabilPayment.stamp,
            provider: 'nabil',
            commission: nabilPayment.commission
        });
    } catch (err) {
        console.error('Error creating Nabil payment:', err);
        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            error: formatInventoryErrorMessage(err)
        });
    }
};

export const createNabilPayment = async (req, res, next) => {
    return _createNabilPaymentInternal(req, res);
};

export const verifyNabilPayment = async (req, res, next) => {
    try {
        validateRequestSize(req.body);
        const { stamp, transactionId, status, nonce } = req.body;

        if (!stamp || !transactionId) {
            throw new Error('Missing stamp or transactionId');
        }

        if (nonce && typeof nonce === 'string' && nonce.length >= 32) {
            const nonceKey = `nabil_verify_nonce:${nonce}`;
            const setResult = await redisClient.set(nonceKey, stamp, { NX: true, EX: 300 });
            if (setResult === null) {
                const existingTicket = await Ticket.genericSearch({ nabilStamp: stamp });
                if (existingTicket) {
                    return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket: existingTicket });
                }
                throw new Error('This payment verification has already been submitted');
            }
        }

        const lockKey = `nabil_verify_lock:${stamp}`;
        const lockAcquired = await redisClient.set(lockKey, transactionId, { NX: true, EX: 60 });
        if (lockAcquired === null) {
            for (let attempt = 0; attempt < 6; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                const existingTicket = await Ticket.genericSearch({ nabilStamp: stamp });
                if (existingTicket) {
                    return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket: existingTicket });
                }
            }
            throw new Error('Payment verification already in progress');
        }

        try {
            let ticket = await Ticket.genericSearch({ nabilStamp: stamp });
            if (ticket) {
                return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket });
            }

            const paymentKey = `nabil_payment:${stamp}`;
            const paymentDataStr = await redisClient.get(paymentKey);
            if (!paymentDataStr) {
                throw new Error('Payment session expired or not found');
            }
            const paymentData = JSON.parse(paymentDataStr);

            const nabilService = (await import('../services/nabilPaymentService.js')).default;
            let paymentStatus = String(status || '').toLowerCase();
            if (paymentStatus !== 'ok' && paymentStatus !== 'success') {
                const verified = await nabilService.verifyPaymentStatus(transactionId, stamp);
                paymentStatus = verified.status;
            }

            if (paymentStatus !== 'ok' && paymentStatus !== 'success' && paymentStatus !== 'paid') {
                throw new Error(`Payment not successful: ${paymentStatus}`);
            }

            const nabilWebhook = await import('./nabil.webhook.js');
            ticket = await nabilWebhook.createTicketFromNabilPayment(paymentData, transactionId, stamp);
            await redisClient.del(paymentKey);

            return res.status(consts.HTTP_STATUS_OK).json({ success: true, ticket });
        } finally {
            await redisClient.del(lockKey).catch(() => {});
        }
    } catch (err) {
        console.error('Error verifying Nabil payment:', err);
        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            error: err.message
        });
    }
};

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

        const checkoutSnapshot = await getCheckoutFulfillmentSnapshot(paymentIntentId);
        if (!checkoutSnapshot) {
            const clientId = getClientIdentifier(req);
            const stripePaymentSummary = await tryGetStripePaymentSummaryForAdminAlert(paymentIntentId, metadata);
            await notifyAdminMissingCheckoutSnapshot({
                paymentIntentId,
                metadata,
                clientId,
                stripePaymentSummary,
            });

            const supportContactEmail = commonUtil.resolveBrandingContactEmail();
            return res.status(consts.HTTP_STATUS_CONFLICT).json({
                success: false,
                error: 'CHECKOUT_SNAPSHOT_EXPIRED',
                code: 'CHECKOUT_SNAPSHOT_EXPIRED',
                message: 'Your payment may have been received but ticket delivery could not be completed automatically. Our team has been notified and will follow up shortly.',
                requiresManualFulfillment: true,
                supportContactEmail,
            });
        }

        try {
            assertPaymentSuccessRequestMatchesSnapshot(metadata, checkoutSnapshot);
        } catch (snapshotMatchError) {
            if (snapshotMatchError?.code === 'CHECKOUT_METADATA_MISMATCH') {
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    success: false,
                    error: snapshotMatchError.message,
                    code: snapshotMatchError.code,
                    mismatches: snapshotMatchError.mismatches,
                });
            }
            throw snapshotMatchError;
        }

        let stripePaymentIntentOptions;
        if (checkoutSnapshot.stripeAccount && !isPlatformStripeAccount(checkoutSnapshot.stripeAccount)) {
            stripePaymentIntentOptions = {
                stripeAccount: checkoutSnapshot.stripeAccount
            };
        }

        const stripePromise = stripePaymentIntentOptions
            ? stripe.paymentIntents.retrieve(paymentIntentId, stripePaymentIntentOptions)
            : stripe.paymentIntents.retrieve(paymentIntentId);
        const paymentIntent = await Promise.race([stripePromise, stripeTimeout]);

        if (paymentIntent.status !== 'succeeded') {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'Payment not successful'
            });
        }

        if (paymentIntent.amount !== checkoutSnapshot.amountCents) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                error: 'Payment amount mismatch',
                code: 'PAYMENT_AMOUNT_MISMATCH',
            });
        }

        const stripeMetadata = paymentIntent.metadata || {};
        const requestMetadata = metadata || {};
        const fulfillment = checkoutSnapshot.fulfillment || {};
        const paymentProvider = String(
            fulfillment.paymentProvider ||
            stripeMetadata.paymentProvider ||
            requestMetadata.paymentProvider ||
            'stripe'
        ).toLowerCase();

        const mergedMetadata = {
            ...fulfillment,
            nonce: fulfillment.nonce || requestMetadata.nonce || stripeMetadata.nonce,
            locale: requestMetadata.locale || fulfillment.locale || stripeMetadata.locale || 'en-US',
        };

        // Validate nonce after merging (can come from snapshot, request, or Stripe metadata)
        const nonce = mergedMetadata.nonce;
        if (!nonce || typeof nonce !== 'string' || nonce.length < 32) {
            throw new Error('Invalid or missing nonce. Please refresh the page and try again.');
        }

        const finalPlaceIds = Array.isArray(fulfillment.placeIds) ? fulfillment.placeIds : [];
        const finalSeatTickets = Array.isArray(fulfillment.seatTickets) ? fulfillment.seatTickets : [];
        const finalSectionSelections = Array.isArray(fulfillment.sectionSelections)
            ? fulfillment.sectionSelections
            : [];

        const merchants = await Merchant.genericSearchMerchant(
            fulfillment.merchantId,
            fulfillment.externalMerchantId
        );
        const merchant = merchants.length > 0 ? merchants[0] : null;
        if (!merchant || merchant.status !== 'active') {
            throw new Error('Merchant is not available or active');
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
            sectionSelections: finalSectionSelections,
            // Additional metadata fields for ticket record - use merged metadata
            fullName: mergedMetadata.fullName ? sanitizeString(mergedMetadata.fullName, 200) : null,
            basePrice: mergedMetadata.basePrice !== undefined && mergedMetadata.basePrice !== null ? sanitizeString(String(mergedMetadata.basePrice), 20) : null,
            serviceFee: mergedMetadata.serviceFee !== undefined && mergedMetadata.serviceFee !== null ? sanitizeString(String(mergedMetadata.serviceFee), 20) : null,
            vatRate: mergedMetadata.vatRate !== undefined && mergedMetadata.vatRate !== null ? sanitizeString(String(mergedMetadata.vatRate), 20) : null,
            vatAmount: mergedMetadata.vatAmount !== undefined && mergedMetadata.vatAmount !== null ? sanitizeString(String(mergedMetadata.vatAmount), 20) : null,
            totalVatAmount: mergedMetadata.totalVatAmount !== undefined && mergedMetadata.totalVatAmount !== null ? sanitizeString(String(mergedMetadata.totalVatAmount), 20) : null,
            entertainmentTax: mergedMetadata.entertainmentTax !== undefined && mergedMetadata.entertainmentTax !== null ? sanitizeString(String(mergedMetadata.entertainmentTax), 20) : null,
            entertainmentTaxAmount: mergedMetadata.entertainmentTaxAmount !== undefined && mergedMetadata.entertainmentTaxAmount !== null ? sanitizeString(String(mergedMetadata.entertainmentTaxAmount), 20) : null,
            serviceTax: mergedMetadata.serviceTax !== undefined && mergedMetadata.serviceTax !== null ? sanitizeString(String(mergedMetadata.serviceTax), 20) : null,
            orderFee: mergedMetadata.orderFee !== undefined && mergedMetadata.orderFee !== null ? sanitizeString(String(mergedMetadata.orderFee), 20) : null,
            country: mergedMetadata.country ? sanitizeString(mergedMetadata.country, 100) : null,
            sessionId: mergedMetadata.sessionId ? sanitizeString(mergedMetadata.sessionId, 100) : null,
            orderFeeServiceTax: mergedMetadata.orderFeeServiceTax !== undefined && mergedMetadata.orderFeeServiceTax !== null ? sanitizeString(String(mergedMetadata.orderFeeServiceTax), 20) : null,
            serviceTaxAmount: mergedMetadata.serviceTaxAmount !== undefined && mergedMetadata.serviceTaxAmount !== null ? sanitizeString(String(mergedMetadata.serviceTaxAmount), 20) : null,
            totalBasePrice: mergedMetadata.totalBasePrice !== undefined && mergedMetadata.totalBasePrice !== null ? sanitizeString(String(mergedMetadata.totalBasePrice), 20) : null,
            totalServiceFee: mergedMetadata.totalServiceFee !== undefined && mergedMetadata.totalServiceFee !== null ? sanitizeString(String(mergedMetadata.totalServiceFee), 20) : null,
            couponCode:
                mergedMetadata.couponCode != null && String(mergedMetadata.couponCode).trim()
                    ? sanitizeString(String(mergedMetadata.couponCode).trim(), 64)
                    : null,
            couponId:
                mergedMetadata.couponId != null && String(mergedMetadata.couponId).trim()
                    ? sanitizeString(String(mergedMetadata.couponId).trim(), 32)
                    : null,
            couponDiscountAmount:
                mergedMetadata.couponDiscountAmount !== undefined && mergedMetadata.couponDiscountAmount !== null
                    ? parseFloat(mergedMetadata.couponDiscountAmount) || 0
                    : undefined,
            catalogBaseSubtotal:
                mergedMetadata.catalogBaseSubtotal !== undefined && mergedMetadata.catalogBaseSubtotal !== null
                    ? parseFloat(mergedMetadata.catalogBaseSubtotal) || 0
                    : undefined,
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
        if (!assertSiloEventAccess(req, res, event)) return;

        // Create ticketInfo object similar to completeOrderTicket
        const ticketInfo = {
            eventName: sanitizedMetadata.eventName,
            ticketName: sanitizedMetadata.ticketName,
            price: paymentIntent.amount / 100, // Convert from cents — authoritative paid total
            totalAmount: paymentIntent.amount / 100,
            totalPrice: paymentIntent.amount / 100,
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
            totalVatAmount: sanitizedMetadata.totalVatAmount !== undefined
                ? sanitizedMetadata.totalVatAmount
                : (sanitizedMetadata.vatAmount !== undefined ? sanitizedMetadata.vatAmount : null),
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
            totalServiceFee: sanitizedMetadata.totalServiceFee !== undefined ? sanitizedMetadata.totalServiceFee : null,
        };

        const ticketTypeConfig = findTicketTypeConfig(event, sanitizedMetadata.ticketId);
        const couponMetadata = enrichMetadataWithCouponPricing(
            sanitizedMetadata,
            event,
            ticketTypeConfig
        );
        attachCouponFieldsToTicketInfo(ticketInfo, couponMetadata);

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
        if (sanitizedMetadata.sectionSelections && sanitizedMetadata.sectionSelections.length > 0) {
            ticketInfo.sectionSelections = sanitizedMetadata.sectionSelections;
        }

        // For seat-based events, store basic seat information
        if (event && event.venue && event.venue.venueId && sanitizedMetadata.placeIds && sanitizedMetadata.placeIds.length > 0) {
            // Just store the placeIds - detailed seat info can be looked up later if needed
            ticketInfo.seats = sanitizedMetadata.placeIds.map(placeId => ({
                placeId: placeId
            }));
        }

        const seatCount = resolveSeatCountFromMetadata(sanitizedMetadata);
        const scanCount = getScanCountFromTicketType(ticketTypeConfig);
        const scanValidation = validateScanCountOrderQuantity(sanitizedMetadata.quantity, scanCount);
        if (!scanValidation.valid) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                error: scanValidation.error
            });
        }
        const { ticketInfo: ticketInfoWithQty, quantities } = applyTicketQuantitiesToTicketInfo(ticketInfo, {
            orderQuantity: sanitizedMetadata.quantity,
            ticketTypeConfig,
            seatCount
        });
        Object.assign(ticketInfo, ticketInfoWithQty);

        const checkoutHostnameForTicket = extractCheckoutHostname({ req, metadata: requestMetadata, fulfillment });
        if (checkoutHostnameForTicket) {
            ticketInfo.checkoutHostname = checkoutHostnameForTicket;
        }

        copyRecordedPlatformFeeToTicketInfo(ticketInfo, {
            paymentIntent,
            stripeMetadata,
            fulfillment,
        });

        if (sanitizedMetadata.ticketId) {
            try {
                validateTicketPurchaseInventory(event, ticketTypeConfig, {
                    orderQuantity: sanitizedMetadata.quantity,
                    seatCount,
                    metadata: sanitizedMetadata
                });
            } catch (invErr) {
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    error: formatInventoryErrorMessage(invErr)
                });
            }
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

            if (existingData?.ticketId) {
                const existingTicket = await Ticket.getTicketById(existingData.ticketId, false);
                if (existingTicket) {
                    const { normalizeLocale } = await import('../util/common.js');
                    const locale = mergedMetadata.locale ? normalizeLocale(mergedMetadata.locale) : 'en-US';
                    const emailOptions = await resolveTicketEmailOptions({
                        req,
                        merchant,
                        metadata: sanitizedMetadata,
                        fulfillment,
                        marketCountryCode: parseRequestMarketCountryCode(req)
                    });
                    if (!existingTicket.isSend) {
                        const existingOtp = existingTicket.otp || await commonUtil.createCode(8);
                        ticketMaster.sendTicketEmailInBackground(
                            event,
                            existingTicket,
                            sanitizedMetadata.email,
                            existingOtp,
                            locale,
                            emailOptions
                        );
                    }
                    return res.status(consts.HTTP_STATUS_OK).json({
                        success: true,
                        data: existingTicket,
                        message: 'Payment already processed',
                        duplicate: true
                    });
                }
            }

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
        // Platform marketing: default opt-in for every new email
        await PlatformMarketingConsent.getOrCreatePlatformConsent(ticketFor);

        const isVenueEvent = !!(event && event.venue && event.venue.venueId);
        const snapshotAssignedPlaceIds =
            finalPlaceIds.length > 0 && finalSectionSelections.length === 0 ? finalPlaceIds : null;
        if (isVenueEvent) {
            try {
                await fulfillSeatPurchaseBeforeTicket({
                    eventId: sanitizedMetadata.eventId,
                    event,
                    sessionId: sanitizedMetadata.sessionId,
                    placeIds: finalPlaceIds,
                    sectionSelections: finalSectionSelections,
                    checkoutToken: fulfillment.checkoutToken || null,
                    snapshotAssignedPlaceIds,
                    logPrefix: '[handlePaymentSuccess]',
                });
            } catch (seatError) {
                if (seatError?.code === 'SEATS_ALREADY_SOLD' || seatError?.code === 'SEATS_CHECKOUT_MISMATCH') {
                    await redisClient.del(paymentIntentReserveKey).catch(() => {});
                    return res.status(consts.HTTP_STATUS_CONFLICT).json({
                        success: false,
                        error: seatError.code,
                        message: seatError.code === 'SEATS_CHECKOUT_MISMATCH'
                            ? 'Payment was received but seat selection does not match checkout. Please contact support for a refund.'
                            : 'Payment was received but these seats are no longer available. Please contact support for a refund.',
                        requiresRefund: true,
                    });
                }
                throw seatError;
            }
        }

        if (sanitizedMetadata.ticketId) {
            const inventoryDecrement = await Event.decrementTicketTypeAvailable(
                event._id,
                sanitizedMetadata.ticketId,
                quantities.admissionQuantity,
                ticketTypeConfig
            );
            if (!inventoryDecrement.success) {
                if (isVenueEvent) {
                    error(`[handlePaymentSuccess] Ticket type inventory drift after seat fulfillment (continuing to honor paid seats)`, {
                        eventId: sanitizedMetadata.eventId,
                        ticketId: sanitizedMetadata.ticketId,
                        admissionQuantity: quantities.admissionQuantity,
                        reason: inventoryDecrement.reason,
                        paymentIntentId,
                    });
                } else {
                    await redisClient.del(paymentIntentReserveKey).catch(() => {});
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        error: 'Not enough tickets remaining for this purchase.'
                    });
                }
            }
        }

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

        if (!ticket?._id && !ticket?.id) {
            throw new Error('Ticket creation failed');
        }

        await Ticket.updateTicketById(ticket._id, {
            paymentProvider,
            paymentReference: paymentIntentId,
            paymentIntentId,
            paymentStatus: 'paid'
        });

        await ticketMaster.provisionGroupChildQRCodes(
            ticket,
            event,
            quantities.admissionQuantity,
            {
                eventId: sanitizedMetadata.eventId,
                merchantId: sanitizedMetadata.merchantId,
                externalMerchantId: sanitizedMetadata.externalMerchantId
            }
        );
        ticket = await Ticket.getTicketById(ticket._id, false);
        ticket = await ticketMaster.prepareTicketForClientResponse(event, ticket);

        // Consume presale token (one-time use) if present in metadata
        const stripePresaleToken = mergedMetadata.presaleToken || null;
        if (stripePresaleToken && typeof stripePresaleToken === 'string') {
            const consumed = await consumePresaleToken(redisClient, stripePresaleToken);
            if (consumed) {
                info('[handlePaymentSuccess] Presale token consumed after successful payment');
            }
        }

        if (sanitizedMetadata.couponCode) {
            try {
                const redeemResult = await Event.decrementCouponUsesLeft(sanitizedMetadata.eventId, sanitizedMetadata.couponCode);
                if (redeemResult.ok && event?.externalMerchantId && event?.externalEventId) {
                    await publishDiscountCodeRedeemed({
                        externalMerchantId: event.externalMerchantId,
                        externalEventId: String(event.externalEventId),
                        discountCodeId: sanitizedMetadata.couponId,
                        paymentReference: paymentIntentId,
                        email: sanitizedMetadata.email,
                        discountAmount: couponMetadata.couponDiscountAmount
                    });
                } else if (!redeemResult.ok) {
                    error('[handlePaymentSuccess] Coupon uses_left decrement failed after payment', {
                        eventId: sanitizedMetadata.eventId,
                        couponCode: sanitizedMetadata.couponCode,
                        paymentIntentId
                    });
                }
            } catch (couponErr) {
                error('[handlePaymentSuccess] Coupon redeem error (non-blocking)', couponErr);
            }
        }

        // Generate email payload and send ticket (same as completeOrderTicket)
        // Event is already loaded above
        // Extract locale from mergedMetadata (prefer request body, fallback to Stripe metadata)
        const { normalizeLocale } = await import('../util/common.js');
        const locale = mergedMetadata.locale ? normalizeLocale(mergedMetadata.locale) : 'en-US';

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

        await deleteCheckoutFulfillmentSnapshot(paymentIntentId).catch((snapshotErr) => {
            console.warn('Failed to delete checkout snapshot (non-critical):', snapshotErr);
        });

        res.status(consts.HTTP_STATUS_OK).json({
            success: true,
            data: ticket,
            message: "Payment processed successfully"
        });

        ticketMaster.sendTicketEmailInBackground(event, ticket, sanitizedMetadata.email, otp, locale, await resolveTicketEmailOptions({
            req,
            merchant,
            metadata: sanitizedMetadata,
            fulfillment,
            marketCountryCode: parseRequestMarketCountryCode(req)
        }));

        // Publish ticket creation event to notify other systems
        try {
            console.log('sanitizedMetadata', sanitizedMetadata, metadata);
            // Validity enforcement for recurring/season tickets:
            // store the ticket expiry as `validUntil` (FEB) so EMS can map it to `valid_until` (Postgres).
            if (event?.event_end_date) {
                ticket.validUntil = new Date(event.event_end_date);
            }
            const ticketForPublish = await Ticket.getTicketById(ticket._id, false);
            await publishTicketCreationEvent(ticketForPublish || ticket, event, sanitizedMetadata, paymentIntentId);
        } catch (publishError) {
            console.error('Failed to publish ticket creation event:', publishError);
            // Don't fail the entire operation if event publishing fails
        }

        try {
            const { publishPaymentCompleted } = await import('../services/accountingEventPublisher.js');
            const checkoutHostname = extractCheckoutHostname({ req, metadata: requestMetadata, fulfillment });
            const checkoutChannel = resolveSiloCheckoutChannel(merchant, checkoutHostname);
            await publishPaymentCompleted({
                ticket,
                event,
                merchant,
                method: paymentProvider,
                externalPaymentId: paymentIntentId,
                grossCents: paymentIntent.amount,
                pspFeeCents: 0,
                checkoutChannel,
                currency: paymentIntent.currency,
            });
        } catch (accountingErr) {
            console.error('Failed to publish accounting payment.completed:', accountingErr);
        }

    } catch (error) {
        console.error('Error handling payment success:', {
            error: error.message,
            stack: error.stack,
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
export const publishTicketCreationEvent = async (ticket, event, metadata, paymentIntentId) => {
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

        try {
            const rawQty = cleanTicket?.ticketInfo?.quantity ?? cleanTicket?.ticketInfo?.qty ?? 1;
            const admissionQuantity = parseInt(String(rawQty), 10) || 1;
            await ticketMaster.provisionGroupChildQRCodes(ticket, event, admissionQuantity, metadata);
            const freshTicket = await Ticket.getTicketById(ticket._id, false);
            if (freshTicket) {
                cleanTicket.ticketInfo = ticketInfoToPlainObjectForPublish(freshTicket.ticketInfo);
            }
        } catch (childQrError) {
            error('Failed to populate childQRCodes in publishTicketCreationEvent:', childQrError?.message || childQrError);
        }

        const ticketTypeIdForInventory =
            cleanTicket?.ticketInfo?.ticketId ?? metadata?.ticketId ?? null;
        const ticketTypeConfigForInventory = findTicketTypeConfig(event, ticketTypeIdForInventory);
        const seatCountForInventory = resolveSeatCountFromPurchaseMetadata(metadata);
        const { quantities: inventoryQuantities } = applyTicketQuantitiesToTicketInfo(
            {},
            {
                orderQuantity: metadata?.quantity ?? cleanTicket?.ticketInfo?.orderQuantity ?? 1,
                ticketTypeConfig: ticketTypeConfigForInventory,
                seatCount: seatCountForInventory
            }
        );

        // Platform marketing consent (per-email, default opt-in for new emails)
        const ticketForId = ticket.ticketFor?._id || ticket.ticketFor;
        const platformConsent = ticketForId ? await PlatformMarketingConsent.getOrCreatePlatformConsent(ticketForId) : null;

        // Create comprehensive event data
        const eventData = {
            eventType: 'TicketCreated',
            aggregateId: ticket._id.toString(),
            data: {
                // Clean ticket object (without QR code and ICS)
                ticket: cleanTicket,
                marketingOptIn: metadata?.marketingOptIn || false,
                platformMarketingOptIn: platformConsent?.platformMarketingOptIn !== false,
                externalEventId: event.externalEventId,
                externalMerchantId: metadata.externalMerchantId,
                merchantId: metadata.merchantId,
                inventory: {
                    ticketTypeId: ticketTypeIdForInventory,
                    admissionQuantity: inventoryQuantities.admissionQuantity,
                    orderQuantity: inventoryQuantities.orderQuantity,
                    packSize: inventoryQuantities.packSize
                },
                // Optional push tokens captured during free registration.
                androidFcmToken: metadata?.androidFcmToken ?? null,
                iosApnsToken: metadata?.iosApnsToken ?? null,
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
                    messageId: outboxMessageData.messageId,
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
        const companyTitle = process.env.COMPANY_TITLE || 'Finnep';

        // Load acknowledgement template
        const acknowledgementHtml = await commonUtil.loadFeedbackTemplate(fullName, email, subject, message);

        // Send acknowledgement email to sender
        const acknowledgementEmail = {
            from: process.env.EMAIL_USERNAME,
            to: email,
            subject: `Thank you for your feedback - ${companyTitle}`,
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

// Public: GDPR-style personal data request (no login required)
export const submitPersonalDataRequest = async (req, res, next) => {
	try {
		const {
			firstName,
			lastName,
			email,
			phone,
			address,
			requestType,
			message,
			consent
		} = req.body || {};

		const normalizedRequestType = typeof requestType === 'string' ? requestType.trim().toLowerCase() : '';

		if (!firstName || !lastName || !email || !normalizedRequestType || !message) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				success: false,
				message: 'All required fields must be provided.'
			});
		}

		const allowedTypes = ['access', 'deletion', 'correction', 'other'];
		if (!allowedTypes.includes(normalizedRequestType)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				success: false,
				message: 'Invalid requestType.'
			});
		}

		const consentBool = consent === true || consent === 'true' || consent === 1 || consent === '1';
		if (!consentBool) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				success: false,
				message: 'Consent is required.'
			});
		}

		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				success: false,
				message: 'Invalid email format.'
			});
		}

		const requesterFullName = `${String(firstName).trim()} ${String(lastName).trim()}`.trim();
		const requestId = uuidv4();
		const companyTitle = process.env.COMPANY_TITLE || 'Finnep';

		await PersonalDataRequest.create({
			requestId,
			status: 'received',
			requester: {
				firstName: String(firstName).trim(),
				lastName: String(lastName).trim(),
				email: String(email).trim().toLowerCase(),
				phone: phone ? String(phone).trim() : '',
				address: address ? String(address).trim() : ''
			},
			requestType: normalizedRequestType,
			message: String(message).trim(),
			consent: consentBool
		});

		// Send acknowledgement to requester + notify privacy inbox
		const acknowledgementHtml = `
			<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 650px; margin: 0 auto;">
				<h2 style="margin: 0 0 12px 0;">Personal data request received</h2>
				<p style="margin: 0 0 12px 0;">Hi ${requesterFullName},</p>
				<p style="margin: 0 0 12px 0;">
					We received your request (${normalizedRequestType}). Your reference id is <strong>${requestId}</strong>.
				</p>
				<p style="margin: 0 0 12px 0;">
					We will review your request and get back to you as required by law.
				</p>
				<p style="margin: 24px 0 0 0; font-size: 12px; color: #666;">
					This is an automated email. Please do not reply directly.
				</p>
			</div>
		`;

		const internalTo = process.env.REPORTING_EMAIL || process.env.EMAIL_USERNAME;

		// Do not fail the API if email sending fails; DB record is already created.
		(async () => {
			try {
				await sendMail.forward({
					from: process.env.EMAIL_USERNAME,
					to: String(email).trim(),
					subject: `Personal data request received - ${companyTitle}`,
					html: acknowledgementHtml
				});
			} catch (mailErr) {
				error('[submitPersonalDataRequest] Failed to send acknowledgement:', mailErr);
			}

			try {
				await sendMail.forward({
					from: process.env.EMAIL_USERNAME,
					to: internalTo,
					subject: `New personal data request (${normalizedRequestType}) - ${requestId}`,
					html: `
						<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 650px;">
							<h2 style="margin: 0 0 12px 0;">New personal data request</h2>
							<p><strong>Reference:</strong> ${requestId}</p>
							<p><strong>Type:</strong> ${normalizedRequestType}</p>
							<p><strong>Name:</strong> ${requesterFullName || 'N/A'}</p>
							<p><strong>Email:</strong> ${String(email).trim()}</p>
							${phone ? `<p><strong>Phone:</strong> ${String(phone).trim()}</p>` : ''}
							${address ? `<p><strong>Address:</strong> ${String(address).trim()}</p>` : ''}
							<p><strong>Message:</strong></p>
							<pre style="white-space: pre-wrap; word-break: break-word; background: #f5f5f5; padding: 12px; border-radius: 6px;">${String(message).trim()}</pre>
						</div>
					`
				});
			} catch (mailErr) {
				error('[submitPersonalDataRequest] Failed to notify internal inbox:', mailErr);
			}
		})();

		return res.status(consts.HTTP_STATUS_OK).json({
			success: true,
			message: 'Request received.',
			requestId
		});
	} catch (err) {
		error('Error submitting personal data request:', err);
		return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
			success: false,
			message: 'Failed to submit request. Please try again later.'
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
                    const companyTitle = process.env.COMPANY_TITLE || 'Finnep';

                    // Load acknowledgement template
                    const acknowledgementHtml = await commonUtil.loadCareerTemplate(fullName, email, phone, position, experience, availability);

                    // Send acknowledgement email to applicant
                    const acknowledgementEmail = {
                        from: process.env.EMAIL_USERNAME,
                        to: email,
                        subject: `Thank you for your application - ${companyTitle}`,
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

        const { email, quantity, eventId, ticketId, merchantId, externalMerchantId, eventName, ticketName, marketingOptIn, sectionSelections, androidFcmToken, iosApnsToken } = req.body;

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
            marketingOptIn: sanitizeBoolean(marketingOptIn || false),
            androidFcmToken: androidFcmToken ? sanitizeString(androidFcmToken, 2048) : null,
            iosApnsToken: iosApnsToken ? sanitizeString(iosApnsToken, 2048) : null,
            sectionSelections: Array.isArray(sectionSelections) ? sectionSelections : []
        };
        const freeCheckoutHostname = extractCheckoutHostname({ req, metadata: sanitizedData });
        if (freeCheckoutHostname) {
            sanitizedData.checkoutHostname = freeCheckoutHostname;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(sanitizedData.email)) {
            throw new Error('Invalid email format');
        }

        const orderQuantityNum = parseInt(sanitizedData.quantity, 10);
        if (isNaN(orderQuantityNum) || orderQuantityNum < 1) {
            throw new Error('Invalid quantity (must be at least 1)');
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
        if (!assertSiloEventAccess(req, res, event)) return;

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
        assertTicketPurchasable(selectedTicket);

        const ticketPrice = selectedTicket ? (parseFloat(selectedTicket.price) || 0) : 0;
        const ticketType = selectedTicket ? selectedTicket.name : sanitizedData.ticketName;

        // Create ticketInfo object similar to handlePaymentSuccess
        const ticketInfo = {
            eventName: sanitizedData.eventName,
            ticketName: sanitizedData.ticketName,
            price: ticketPrice,
            totalPrice: ticketPrice,
            totalAmount: ticketPrice,
            currency: 'EUR', // Default currency for free events
            purchaseDate: new Date().toISOString(),
            email: sanitizedData.email,
            merchantId: sanitizedData.merchantId,
            eventId: sanitizedData.eventId,
            ticketId: sanitizedData.ticketId || null,
            paymentProvider: 'free',
            isFree: true
        };
        if (freeCheckoutHostname) {
            ticketInfo.checkoutHostname = freeCheckoutHostname;
        }
        if (Array.isArray(sanitizedData.sectionSelections) && sanitizedData.sectionSelections.length > 0) {
            ticketInfo.sectionSelections = sanitizedData.sectionSelections;
        }

        const seatCount = resolveSeatCountFromMetadata(sanitizedData);
        const scanCount = getScanCountFromTicketType(selectedTicket);
        const scanValidation = validateScanCountOrderQuantity(sanitizedData.quantity, scanCount);
        if (!scanValidation.valid) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                error: scanValidation.error
            });
        }
        const { ticketInfo: ticketInfoWithQty, quantities } = applyTicketQuantitiesToTicketInfo(ticketInfo, {
            orderQuantity: sanitizedData.quantity,
            ticketTypeConfig: selectedTicket,
            seatCount
        });
        Object.assign(ticketInfo, ticketInfoWithQty);

        if (selectedTicket && sanitizedData.ticketId) {
            try {
                validateTicketPurchaseInventory(event, selectedTicket, {
                    orderQuantity: sanitizedData.quantity,
                    seatCount,
                    metadata: sanitizedData
                });
            } catch (invErr) {
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    success: false,
                    error: formatInventoryErrorMessage(invErr)
                });
            }
            const inventoryDecrement = await Event.decrementTicketTypeAvailable(
                event._id,
                sanitizedData.ticketId,
                quantities.admissionQuantity,
                selectedTicket
            );
            if (!inventoryDecrement.success) {
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    success: false,
                    error: 'Not enough tickets remaining for this registration.'
                });
            }
        }

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
        // Platform marketing: default opt-in for every new email
        await PlatformMarketingConsent.getOrCreatePlatformConsent(ticketFor);

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

        if (!ticket?._id && !ticket?.id) {
            throw new Error('Ticket creation failed');
        }

        await ticketMaster.provisionGroupChildQRCodes(
            ticket,
            event,
            quantities.admissionQuantity,
            {
                eventId: sanitizedData.eventId,
                merchantId: sanitizedData.merchantId,
                externalMerchantId: sanitizedData.externalMerchantId
            }
        );
        ticket = await Ticket.getTicketById(ticket._id, false);
        ticket = await ticketMaster.prepareTicketForClientResponse(event, ticket);

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

        const locale = commonUtil.extractLocaleFromRequest(req);
        ticketMaster.sendTicketEmailInBackground(event, ticket, sanitizedData.email, otp, locale, await resolveTicketEmailOptions({
            req,
            merchant,
            metadata: sanitizedData,
            fulfillment: sanitizedData,
            marketCountryCode: parseRequestMarketCountryCode(req)
        }));

        // Publish ticket creation event to notify other systems
        try {
            // Validity enforcement for recurring/season tickets:
            // store the ticket expiry as `validUntil` (FEB) so EMS can map it to `valid_until` (Postgres).
            if (event?.event_end_date) {
                ticket.validUntil = new Date(event.event_end_date);
            }
            const ticketForPublish = await Ticket.getTicketById(ticket._id, false);
            await publishTicketCreationEvent(ticketForPublish || ticket, event, sanitizedData, null); // null for paymentIntentId since it's free
        } catch (publishError) {
            console.error('Failed to publish ticket creation event:', publishError);
            // Don't fail the entire operation if event publishing fails
        }

        try {
            const { publishPaymentCompleted } = await import('../services/accountingEventPublisher.js');
            await publishPaymentCompleted({
                ticket,
                event,
                merchant,
                method: 'free',
                externalPaymentId: `free:${ticket._id}`,
                grossCents: 0,
                pspFeeCents: 0,
                checkoutChannel: resolveSiloCheckoutChannel(
                    merchant,
                    freeCheckoutHostname || extractCheckoutHostname({ req, metadata: sanitizedData })
                ),
                currency: 'eur',
            });
        } catch (accountingErr) {
            console.error('Failed to publish accounting payment.completed:', accountingErr);
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
		const queryEmail = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
		const querySessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : '';
		const queryCheckoutToken =
			typeof req.query.checkoutToken === 'string' ? req.query.checkoutToken.trim() : '';

		// 1. Get event by external ID to check if it has seat selection enabled
		// Use .lean() for faster queries (returns plain objects, not Mongoose documents)
		const event = await Event.getEventById(externalEventId);
		if (!event) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Event not found',
				error: RESOURCE_NOT_FOUND
			});
		}

		// Check if event has seat selection
		if (!eventHasSeatSelection(event)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Event does not have seat selection enabled',
				error: 'SEAT_SELECTION_NOT_ENABLED'
			});
		}

		// 2. Load encoded manifest from MongoDB (EventManifest collection).
		// Do not populate venue here — missing Venue docs would null out the ref id we need.
		const eventMongoId = String(event._id);

		const encodedManifest = await EventManifest.findOne({ eventId: eventMongoId }).lean();

		if (!encodedManifest) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Manifest not found for this event',
				error: RESOURCE_NOT_FOUND
			});
		}

		const manifestVenueId = encodedManifest.venue ? String(encodedManifest.venue) : null;
		const venueRefId = event.venue?.venueId || manifestVenueId;
		const s3Key = encodedManifest.s3Key || event.venue?.manifestS3Key || null;
		const isPricingConfiguration = event.venue?.pricingModel === 'pricing_configuration';

		let venue = null;
		let venuePlaces = [];

		if (isPricingConfiguration && s3Key) {
			let fullManifest = null;
			try {
				fullManifest = await downloadPricingFromS3(s3Key);
			} catch (s3Err) {
				error('[getEventSeatsPublic] Failed to download pricing manifest from S3', s3Err);
			}

			const ctx = await loadVenueSectionContext({ venueId: venueRefId, s3Key });
			const venueDoc = ctx.venue;
			let sections =
				(ctx.sections?.length ? ctx.sections : null) ||
				(Array.isArray(fullManifest?.sections) && fullManifest.sections.length > 0
					? fullManifest.sections
					: null) ||
				[];
			venuePlaces =
				(ctx.places?.length ? ctx.places : null) ||
				fullManifest?.places ||
				[];
			if (sections.length === 0 && venuePlaces.length > 0) {
				sections = deriveSectionsFromPlaces(venuePlaces);
			}
			venue = {
				...(venueDoc || {}),
				sections,
				backgroundSvg: venueDoc?.backgroundSvg || fullManifest?.backgroundSvg || null,
			};
		} else {
			let venueDoc = venueRefId ? await Venue.findById(venueRefId).lean() : null;
			if (!venueDoc) {
				return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
					message: 'Venue not found for this event',
					error: RESOURCE_NOT_FOUND
				});
			}

			venue = venueDoc;
			const venueManifest = await Manifest.findOne({ venue: venueDoc._id || venueRefId })
				.sort({ createdAt: -1 })
				.lean();
			if (!venueManifest) {
				return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
					message: 'Venue manifest not found',
					error: RESOURCE_NOT_FOUND
				});
			}

			venuePlaces = Array.isArray(venueManifest.places) ? venueManifest.places : [];
			if (venuePlaces.length === 0) {
				const { places: placesFallback } = await loadVenueSectionContext({
					venueId: venueDoc._id || venueRefId,
					s3Key,
				});
				venuePlaces = placesFallback;
			}
		}

		const encodedPlaceIds = encodedManifest.placeIds || [];
		if (
			(!venue?.sections || venue.sections.length === 0) &&
			venuePlaces.length > 0
		) {
			venue = venue || {};
			venue.sections = deriveSectionsFromPlaces(venuePlaces);
		}
		if (
			(!venue?.sections || venue.sections.length === 0) &&
			encodedPlaceIds.length === 0
		) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Venue not found in manifest or missing required data',
				error: RESOURCE_NOT_FOUND
			});
		}

		// placeIds array contains all encoded data (section, row, seat, x, y, tierCode, available, tags)
		// Frontend will decode placeIds directly - no need to send places array
		const reservedMap = await seatReservationService.getReservedSeats(externalEventId);
		const reservedPlaceIds = Array.from(reservedMap.keys());
		const ownReservedSet = new Set();
		let tokenCheckoutSession = null;
		if (queryCheckoutToken) {
			const tokenSession = await getSeatCheckoutSessionByToken(queryCheckoutToken);
			if (tokenSession && String(tokenSession.eventId) === String(externalEventId)) {
				tokenCheckoutSession = tokenSession;
				const tokenSessionId =
					typeof tokenSession.sessionId === 'string' ? tokenSession.sessionId.trim() : '';
				if (tokenSessionId) {
					for (const [placeId, holderSessionId] of reservedMap.entries()) {
						if (holderSessionId === tokenSessionId) {
							ownReservedSet.add(placeId);
						}
					}
				}
			}
		}

		const tokenEmail =
			typeof tokenCheckoutSession?.email === 'string'
				? tokenCheckoutSession.email.trim().toLowerCase()
				: '';
		const tokenSessionId =
			typeof tokenCheckoutSession?.sessionId === 'string'
				? tokenCheckoutSession.sessionId.trim()
				: '';

		if (queryEmail || querySessionId || tokenEmail || tokenSessionId) {
			for (const placeId of reservedPlaceIds) {
				if (ownReservedSet.has(placeId)) continue;
				const emailCandidates = [queryEmail, tokenEmail].filter(Boolean);
				let matchedByEmail = false;
				for (const emailCandidate of emailCandidates) {
					const ownedSessionId = await seatReservationService.getReservation(
						externalEventId,
						placeId,
						emailCandidate
					);
					if (ownedSessionId) {
						ownReservedSet.add(placeId);
						matchedByEmail = true;
						break;
					}
				}
				if (matchedByEmail) continue;
				const holderSessionId = reservedMap.get(placeId);
				if (querySessionId && holderSessionId === querySessionId) {
					ownReservedSet.add(placeId);
					continue;
				}
				if (tokenSessionId && holderSessionId === tokenSessionId) {
					ownReservedSet.add(placeId);
				}
			}
		}
		const ownReservedPlaceIds = Array.from(ownReservedSet);

		// Format sections from venue (contains polygon and spacingConfig)
		const formattedSections = (venue.sections || []).map(section => {
			const sectionId = section.id || section._id?.toString() || section.name;
			const sectionPlaces = venuePlaces.filter((p) => p.section === section.name || p.section === sectionId);
			const hasSeatLikePlaces = sectionPlaces.some(placeHasSeatCoordinates);
			// Runtime correction for stale manifests: if section has real row/seat places,
			// treat it as seat mode regardless of persisted selectionMode.
			const correctedSelectionMode = hasSeatLikePlaces ? 'seat' : resolveSectionMode(section);
			return {
			id: section.id || section._id?.toString() || section.name,
			name: section.name,
			sectionType: section.sectionType || 'Seating',
			selectionMode: correctedSelectionMode,
			capacity: section.capacity || 0,
			color: section.color || '#2196F3',
			bounds: section.bounds || null,
			// Clean polygon points to remove MongoDB _id fields
			polygon: section.polygon ? section.polygon.map(point => ({
				x: point.x,
				y: point.y
			})) : null,
			spacingConfig: section.spacingConfig || null
		};
		});

		const reservedSet = new Set(reservedPlaceIds);
		const areaSoldCounts = encodedManifest.availability?.areaSoldCounts || {};
		const readAreaSoldCount = (key) => {
			if (!key) return 0;
			if (typeof areaSoldCounts?.get === 'function') {
				return Number(areaSoldCounts.get(String(key)) || 0) || 0;
			}
			return Number(areaSoldCounts[String(key)] || 0) || 0;
		};
		const areaSections = formattedSections
			.filter(section => section.selectionMode === 'area')
			.map((section) => {
				const sectionPlaces = venuePlaces.filter((p) => p.section === section.name || p.section === section.id);
				const soldCount = readAreaSoldCount(section.id) || readAreaSoldCount(section.name);
				const reservedCount = sectionPlaces.filter((p) => reservedSet.has(p.placeId) && !ownReservedSet.has(p.placeId)).length;
				const inferredCapacity = sectionPlaces.length;
				const capacity = Number(section.capacity || inferredCapacity || 0);
				return {
					id: section.id,
					name: section.name,
					sectionType: section.sectionType || 'Custom',
					selectionMode: 'area',
					capacity,
					soldCount,
					reservedCount,
					availableCount: Math.max(0, capacity - soldCount - reservedCount),
					color: section.color || '#2196F3'
				};
			});

		// 7. Return EventManifest + Venue Manifest data (everything in one response)
		// With .lean(), encodedManifest and venue are already plain objects (no .toObject() needed)
		// This significantly speeds up JSON serialization

		// Build response data object (plain JavaScript objects for fast serialization)
		const responseData = {
			// EventManifest fields (Ticketmaster format)
			eventId: encodedManifest.eventId,
			updateHash: encodedManifest.updateHash,
			updateTime: encodedManifest.updateTime,
			placeIds: encodedManifest.placeIds || [],
			partitions: encodedManifest.partitions || [],

			// Availability
			sold: encodedManifest.availability?.sold || [],
			reserved: reservedPlaceIds, // From Redis
			ownReserved: ownReservedPlaceIds,

			// Pricing configuration (when pricing is encoded in placeIds)
			pricingConfig: encodedManifest.pricingConfig || null,

			// Venue Manifest data (sections, backgroundSvg)
			// Note: places array removed - frontend decodes everything from placeIds
			backgroundSvg: venue.backgroundSvg || null,
			sections: formattedSections, // Use venue.sections with polygon and spacingConfig
			areaSections,

			// Metadata
			venue: {
				pricingModel: event.venue?.pricingModel || 'ticket_info', // Include pricingModel from event
				sections: formattedSections // Also include in venue object for frontend compatibility
			},
			pricingConfigurationId: encodedManifest.pricingConfigurationId
		};

		return res.status(consts.HTTP_STATUS_OK).json({ data: responseData });
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
		const { placeIds, sectionSelections, sessionId, email, fullName } = req.body;

		let resolvedPlaceIds = Array.isArray(placeIds) ? [...placeIds] : [];

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
		const normalizedEmail = email.trim().toLowerCase();

		if ((resolvedPlaceIds.length === 0) && Array.isArray(sectionSelections) && sectionSelections.length > 0) {
			const event = await Event.getEventById(eventId);
			if (!event) {
				return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
					message: 'Event not found',
					error: RESOURCE_NOT_FOUND
				});
			}
			const eventMongoId = String(event._id);
			const encodedManifest = await EventManifest.findOne({ eventId: eventMongoId }).lean();
			const { sections: venueSections, places } = await loadVenueSectionContext({
				venueId: event.venue?.venueId,
				s3Key: encodedManifest?.s3Key
			});
			const soldSet = new Set(encodedManifest?.availability?.sold || []);
			const reservedMap = await seatReservationService.getReservedSeats(eventId);
			const reservedSet = new Set(reservedMap.keys());
			const sectionsById = new Map();
			for (const s of venueSections) {
				const keys = [
					s?.id,
					s?._id?.toString(),
					s?.name,
					typeof s?.name === 'string' ? s.name.toLowerCase() : null
				]
					.filter((k) => k !== null && k !== undefined)
					.map((k) => String(k).trim())
					.filter((k) => k.length > 0);
				for (const k of keys) {
					if (!sectionsById.has(k)) sectionsById.set(k, s);
				}
			}

			for (const selection of sectionSelections) {
				const sectionId = String(selection.sectionId || '');
				const requestedSectionName = typeof selection.sectionName === 'string' ? selection.sectionName : null;
				const quantity = Number(selection.quantity || 0);
				if (!sectionId || quantity <= 0) continue;
				const section =
					sectionsById.get(sectionId) || sectionsById.get(sectionId.toLowerCase());
				const sectionName = requestedSectionName || section?.name;
				// Best-effort match: places may reference section by `name` or by `id`.
				const sectionPlaces = places.filter((p) => {
					if (!p?.section) return false;
					if (sectionName && p.section === sectionName) return true;
					return p.section === sectionId;
				});
				const hasSeatLikePlaces = sectionPlaces.some(placeHasSeatCoordinates);
				// If we couldn't resolve the section metadata (missing in venue manifest),
				// fall back to seat/area inference based purely on whether the places look seat-like.
				const selectionMode = hasSeatLikePlaces ? 'seat' : (section ? resolveSectionMode(section) : 'area');
				if (selectionMode !== 'area') continue;
				const candidates = sectionPlaces.filter((p) => !soldSet.has(p.placeId) && !reservedSet.has(p.placeId));
				resolvedPlaceIds.push(...candidates.slice(0, quantity).map((p) => p.placeId));
			}
		}

		if (!resolvedPlaceIds || resolvedPlaceIds.length === 0) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'placeIds or sectionSelections are required',
				error: 'INVALID_DATA'
			});
		}

		const eventForSoldCheck = await Event.getEventById(eventId);
		if (!eventForSoldCheck) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
				message: 'Event not found',
				error: RESOURCE_NOT_FOUND
			});
		}
		const manifestForSoldCheck = await EventManifest.findOne({
			eventId: String(eventForSoldCheck._id),
		}).lean();
		const soldSet = new Set(manifestForSoldCheck?.availability?.sold || []);
		const alreadySold = resolvedPlaceIds.filter((placeId) => soldSet.has(placeId));
		if (alreadySold.length > 0) {
			return res.status(consts.HTTP_STATUS_CONFLICT).json({
				message: 'Some seats are already sold',
				error: 'SEATS_ALREADY_SOLD',
				data: { sold: alreadySold },
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
		const availability = await seatReservationService.checkAvailability(eventId, resolvedPlaceIds, sessionId, normalizedEmail);
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
		const result = await seatReservationService.reserveSeats(eventId, resolvedPlaceIds, sessionId, normalizedEmail);

		if (result.failed.length > 0) {
			return res.status(consts.HTTP_STATUS_CONFLICT).json({
				message: 'Some seats could not be reserved',
				error: 'RESERVATION_FAILED',
				data: result
			});
		}

		await refreshSeatEmailVerified(eventId, normalizedEmail);

		const checkoutSession = await createSeatCheckoutSession({
			eventId,
			email: normalizedEmail,
			fullName: typeof fullName === 'string' ? fullName.trim() : '',
			sessionId,
			placeIds: Array.isArray(placeIds) ? placeIds : [],
			sectionSelections: sectionSelections || [],
			resolvedPlaceIds
		});

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'Seats reserved successfully',
			data: {
				...result,
				resolvedPlaceIds,
				sectionSelections: sectionSelections || [],
				checkoutToken: checkoutSession.checkoutToken,
				expiresAt: checkoutSession.expiresAt,
				sessionId
			}
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
		const { placeIds, sessionId, email, checkoutToken } = req.body;

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
		const normalizedEmail = email.trim().toLowerCase();

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
			const reservationSessionId = await seatReservationService.getReservation(eventId, placeId, normalizedEmail);
			if (reservationSessionId && reservationSessionId !== sessionId) {
				return res.status(consts.HTTP_STATUS_CONFLICT).json({
					message: `Seat ${placeId} is reserved by a different session`,
					error: 'SESSION_MISMATCH'
				});
			}
		}

		// Release reservations (pass email to release only this user's reservations)
		const releasedCount = await seatReservationService.releaseReservations(eventId, placeIds, normalizedEmail);

		if (checkoutToken && typeof checkoutToken === 'string' && checkoutToken.trim()) {
			await removePlaceIdsFromSeatCheckoutSession(checkoutToken.trim(), placeIds);
		}

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
		const { email, fullName, placeIds, sectionSelections } = req.body;

		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid email address is required',
				error: 'INVALID_EMAIL'
			});
		}
		// Normalize email so OTP lookup is stable even if frontend changes casing/whitespace.
		const normalizedEmail = email.trim().toLowerCase();

		if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Full name is required',
				error: 'INVALID_NAME'
			});
		}

		const hasPlaceIds = Array.isArray(placeIds) && placeIds.length > 0;
		const hasSectionSelections = Array.isArray(sectionSelections) && sectionSelections.some(s => Number(s?.quantity || 0) > 0);
		if (!hasPlaceIds && !hasSectionSelections) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'placeIds or sectionSelections are required',
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
		const otpKey = `seat_otp:${eventId}:${normalizedEmail}`;
		await redisClient.set(otpKey, hashedCode, { EX: 300 }); // 5 minutes

		// Store email and fullName for later verification
		const userDataKey = `seat_user:${eventId}:${normalizedEmail}`;
		await redisClient.set(
			userDataKey,
			JSON.stringify({ email: normalizedEmail, fullName, placeIds: placeIds || [], sectionSelections: sectionSelections || [] }),
			{ EX: 600 }
		); // 10 minutes

		// Extract locale from request
		const locale = commonUtil.extractLocaleFromRequest(req);

		const event = await Event.getEventById(eventId);
		const eventMerchantId = event?.merchant?._id?.toString?.() || event?.merchant?.toString?.();
		const merchant = eventMerchantId ? await Merchant.getMerchantById(eventMerchantId) : null;
		const checkoutHostname = extractCheckoutHostname({ req });
		const siloOpts = merchant && shouldUseSiloTicketEmail(merchant, checkoutHostname)
			? { channel: 'silo', merchant }
			: null;

		try {
			if (siloOpts) {
				const {
					loadSiloVerificationCodeTemplate,
					getSiloEmailSubject
				} = await import('../util/siloMail.js');
				const { resolveSiloEmailBranding } = await import('../util/siloEmailSettings.js');
				const { queueSiloEmail } = await import('../workers/emailWorker.js');
				const branding = resolveSiloEmailBranding(merchant);
				const emailHtml = await loadSiloVerificationCodeTemplate(code, locale, branding);
				const emailSubject = await getSiloEmailSubject('verification_code', locale, { companyName: branding.companyName });
				await queueSiloEmail(String(merchant._id || merchant.id), {
					to: normalizedEmail,
					subject: emailSubject,
					html: emailHtml,
					replyTo: branding.replyTo || undefined
				});
			} else {
				const emailHtml = await commonUtil.loadVerificationCodeTemplate(code, locale);
				const { getEmailSubject } = await import('../util/emailTranslations.js');
				const emailSubject = await getEmailSubject('verification_code', locale, { companyName: process.env.COMPANY_TITLE || 'Finnep' });
				const emailPayload = {
					from: process.env.EMAIL_USERNAME,
					to: normalizedEmail,
					subject: emailSubject,
					html: emailHtml
				};
				await sendMail.forward(emailPayload);
			}
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
		const { email, otp, placeIds, sectionSelections } = req.body;

		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid email address is required',
				error: 'INVALID_EMAIL'
			});
		}
		// Normalize email so OTP lookup is stable even if frontend changes casing/whitespace.
		const normalizedEmail = email.trim().toLowerCase();

		if (!otp || typeof otp !== 'string' || otp.length !== 8) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid 8-digit code is required',
				error: 'INVALID_OTP'
			});
		}

		const hasPlaceIds = Array.isArray(placeIds) && placeIds.length > 0;
		const hasSectionSelections = Array.isArray(sectionSelections) && sectionSelections.some(s => Number(s?.quantity || 0) > 0);
		if (!hasPlaceIds && !hasSectionSelections) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'placeIds or sectionSelections are required',
				error: 'INVALID_DATA'
			});
		}

		// Get stored OTP from Redis
		const redisClient = (await import('../model/redisConnect.js')).default;
		const otpKey = `seat_otp:${eventId}:${normalizedEmail}`;
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

		const verifiedAt = await setSeatEmailVerified(eventId, normalizedEmail);

		// Get user data
		const userDataKey = `seat_user:${eventId}:${normalizedEmail}`;
		const userDataStr = await redisClient.get(userDataKey);
		if (!userDataStr) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Session expired. Please start over.',
				error: 'SESSION_EXPIRED'
			});
		}

		const userData = JSON.parse(userDataStr);

		// Verify placeIds match
		const normalizedIncomingPlaceIds = Array.isArray(placeIds) ? [...placeIds].sort() : [];
		const normalizedStoredPlaceIds = Array.isArray(userData.placeIds) ? [...userData.placeIds].sort() : [];
		const normalizedIncomingSections = Array.isArray(sectionSelections) ? [...sectionSelections] : [];
		const normalizedStoredSections = Array.isArray(userData.sectionSelections) ? [...userData.sectionSelections] : [];
		if (
			JSON.stringify(normalizedStoredPlaceIds) !== JSON.stringify(normalizedIncomingPlaceIds) ||
			JSON.stringify(normalizedStoredSections) !== JSON.stringify(normalizedIncomingSections)
		) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Selected seats/sections do not match',
				error: 'PLACEIDS_MISMATCH'
			});
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'OTP verified successfully',
			success: true,
			data: {
				email: userData.email,
				fullName: userData.fullName,
				emailTrusted: true,
				verifiedAt,
				trustExpiresAt: new Date(Date.now() + 600 * 1000).toISOString()
			}
		});
	} catch (err) {
		error('Error verifying seat OTP:', err);
		next(err);
	}
};

/**
 * Check whether email is still within the 10-minute trust window (skip OTP).
 */
export const checkSeatEmailTrust = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const { email } = req.body;

		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Valid email address is required',
				error: 'INVALID_EMAIL'
			});
		}

		const trust = await getSeatEmailTrust(eventId, email);
		return res.status(consts.HTTP_STATUS_OK).json({
			success: true,
			data: trust
		});
	} catch (err) {
		error('Error checking seat email trust:', err);
		next(err);
	}
};

/**
 * Restore an in-progress checkout session by token.
 */
export const getSeatCheckoutSession = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const checkoutToken = req.query.token;

		if (!checkoutToken || typeof checkoutToken !== 'string') {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'checkout token is required',
				error: 'INVALID_DATA'
			});
		}

		const session = await getSeatCheckoutSessionByToken(checkoutToken);
		if (!session || String(session.eventId) !== String(eventId)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Checkout session not found or expired',
				error: 'SESSION_NOT_FOUND'
			});
		}

		const placeIds = session.resolvedPlaceIds?.length
			? session.resolvedPlaceIds
			: session.placeIds;
		const availability = await seatReservationService.checkAvailability(
			eventId,
			placeIds,
			session.sessionId,
			session.email
		);

		const holdsActive =
			placeIds.length > 0 &&
			availability.reserved.length === 0 &&
			availability.available.length === placeIds.length;

		if (!holdsActive) {
			await deleteSeatCheckoutSession(checkoutToken);
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Seat holds expired or no longer available',
				error: 'HOLDS_EXPIRED'
			});
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			success: true,
			data: {
				...session,
				holdsActive: true
			}
		});
	} catch (err) {
		error('Error getting seat checkout session:', err);
		next(err);
	}
};

/**
 * Release all seats for a checkout session and clear checkout token.
 */
export const releaseSeatCheckoutSession = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const { sessionId, email, checkoutToken } = req.body;

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

		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(sessionId)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
				message: 'Invalid sessionId format',
				error: 'INVALID_SESSION_ID'
			});
		}

		const normalizedEmail = email.trim().toLowerCase();
		const { released, placeIds } = await seatReservationService.releaseReservationsBySession(
			eventId,
			sessionId,
			normalizedEmail
		);

		if (checkoutToken) {
			await deleteSeatCheckoutSession(checkoutToken);
		}

		return res.status(consts.HTTP_STATUS_OK).json({
			message: 'Checkout session released successfully',
			data: { released, placeIds }
		});
	} catch (err) {
		error('Error releasing seat checkout session:', err);
		next(err);
	}
};

// ==================== Event-merchant-service proxies (waitlist, survey) ====================

export const validateDiscountCode = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const { code, orderBaseSubtotal } = req.body || {};
		if (!code || typeof code !== 'string' || !code.trim()) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ valid: false, error: 'Discount code is required' });
		}
		const event = await Event.getEventById(eventId);
		if (!event) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND });
		}
		const doc = event._doc ?? event;
		const validation = validateCouponOnEvent(doc, code);
		if (!validation.valid) {
			return res.status(consts.HTTP_STATUS_OK).json({ valid: false, error: validation.error });
		}
		const ticket = doc.ticketInfo?.[0] || { price: 0 };
		const baseSubtotal = orderBaseSubtotal != null
			? Number(orderBaseSubtotal)
			: getBaseSubtotalForCoupon(ticket, doc, 1, {});
		const discountAmount = computeDiscountAmount(validation.coupon, baseSubtotal);
		return res.status(consts.HTTP_STATUS_OK).json({
			valid: true,
			code: validation.coupon.code,
			name: validation.coupon.name,
			discountType: validation.coupon.discount_type,
			discountValue: validation.coupon.discount_value,
			discountAmount,
			couponId: validation.coupon.id
		});
	} catch (err) {
		error('validateDiscountCode:', err);
		next(err);
	}
};

const WAITLIST_OTP_TTL = 300; // 5 minutes
const WAITLIST_SEND_COOLDOWN = 60; // 1 minute between send-code per email per event

/**
 * POST /event/:eventId/waitlist/send-code - send verification code to email.
 * Rate-limited; code valid 5 minutes.
 */
export const sendWaitlistCode = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const { email } = req.body || {};
		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Valid email required' });
		}
		const normalizedEmail = email.trim().toLowerCase();
		const event = await Event.getEventById(eventId);
		if (!event) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND });
		}
		const doc = event._doc ?? event;
		const offer = computeWaitlistOffer(doc);
		if (!offer) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Waitlist is not available for this event' });
		}
		const redisClient = (await import('../model/redisConnect.js')).default;
		const cooldownKey = `waitlist_sent_at:${eventId}:${normalizedEmail}`;
		const existing = await redisClient.get(cooldownKey);
		if (existing) {
			return res.status(consts.HTTP_STATUS_TOO_MANY_REQUESTS).json({ error: 'Please wait before requesting another code' });
		}
		const VerificationCode = (await import('../model/verificationCode.js'));
		const code = Math.floor(10000000 + Math.random() * 90000000).toString(); // 8-digit
		const hashedCode = VerificationCode.hashCode(code);
		const otpKey = `waitlist_otp:${eventId}:${normalizedEmail}`;
		await redisClient.set(otpKey, hashedCode, { EX: WAITLIST_OTP_TTL });
		await redisClient.set(cooldownKey, '1', { EX: WAITLIST_SEND_COOLDOWN });
		const locale = commonUtil.extractLocaleFromRequest(req);
		const emailHtml = await commonUtil.loadVerificationCodeTemplate(code, locale);
		const { getEmailSubject } = await import('../util/emailTranslations.js');
		const emailSubject = await getEmailSubject('verification_code', locale, { companyName: process.env.COMPANY_TITLE || 'Finnep' });
		const sendMail = await import('../util/sendMail.js');
		try {
			await sendMail.forward({
				from: process.env.EMAIL_USERNAME,
				to: normalizedEmail,
				subject: emailSubject,
				html: emailHtml
			});
		} catch (emailErr) {
			error('[sendWaitlistCode] email send failed', emailErr);
			return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({ error: 'Failed to send code' });
		}
		return res.status(consts.HTTP_STATUS_OK).json({ message: 'Verification code sent to your email' });
	} catch (err) {
		error('sendWaitlistCode:', err);
		next(err);
	}
};

/**
 * POST /event/:eventId/waitlist - join waitlist (public). Requires email + code (from send-code).
 * Verifies code (5 min TTL), derives type from event state, then publishes to event-merchant-service.
 */
export const joinWaitlistProxy = async (req, res, next) => {
	try {
		const eventId = req.params.eventId;
		const { email, code } = req.body || {};
		info('[joinWaitlistProxy] called', { eventId, hasEmail: !!email, hasCode: !!code });
		if (!email || typeof email !== 'string' || !email.includes('@')) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Valid email required' });
		}
		if (!code || typeof code !== 'string' || code.length < 5) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Verification code required' });
		}
		const normalizedEmail = email.trim().toLowerCase();
		const event = await Event.getEventById(eventId);
		if (!event) {
			info('[joinWaitlistProxy] event not found', { eventId });
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND });
		}
		const doc = event._doc ?? event;
		const type = computeWaitlistOffer(doc);
		if (!type) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Waitlist is not available for this event' });
		}
		const redisClient = (await import('../model/redisConnect.js')).default;
		const otpKey = `waitlist_otp:${eventId}:${normalizedEmail}`;
		const storedHashed = await redisClient.get(otpKey);
		if (!storedHashed) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Invalid or expired code. Request a new code.' });
		}
		const VerificationCode = (await import('../model/verificationCode.js'));
		if (!VerificationCode.verifyCode(code.trim(), storedHashed)) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Invalid verification code' });
		}
		await redisClient.del(otpKey);
		// Clear send-code cooldown so user can request a new code (e.g. for another event) without waiting
		const cooldownKey = `waitlist_sent_at:${eventId}:${normalizedEmail}`;
		await redisClient.del(cooldownKey);
		let externalMerchantId = doc.externalMerchantId;
		// Normalize to string to avoid JS number precision loss (values > 2^53 lose precision as number)
		let externalEventId = doc.externalEventId != null ? String(doc.externalEventId) : undefined;
		if (!externalMerchantId && event.merchant) {
			const m = event.merchant._doc ?? event.merchant;
			externalMerchantId = m.merchantId ?? m.id;
		}
		if (!externalMerchantId || externalEventId == null || externalEventId === '') {
			info('[joinWaitlistProxy] event not linked to merchant', { eventId, externalMerchantId: !!externalMerchantId, externalEventId: externalEventId != null });
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Event not linked to merchant' });
		}
		const exchangeName = process.env.RABBITMQ_EXCHANGE || 'event-merchant-exchange';
		// Keep event_id as string to avoid JS number precision loss (event-merchant events.id can be bigint)
		const data = {
			merchant_id: String(externalMerchantId),
			event_id: String(externalEventId),
			email: normalizedEmail,
			type
		};
		const correlationId = uuidv4();
		const messageId = uuidv4();
		const aggregateId = (doc._id || event._id || event.id).toString();
		const messageBody = {
			eventType: 'WaitlistJoin',
			aggregateId,
			data,
			metadata: {
				correlationId,
				causationId: messageId,
				timestamp: new Date().toISOString(),
				version: 1,
				source: 'finnep-eventapp',
			}
		};
		const outboxMessageData = {
			messageId,
			exchange: exchangeName,
			routingKey: 'waitlist.join',
			messageBody,
			headers: {
				'content-type': 'application/json',
				'message-type': 'WaitlistJoin',
				'correlation-id': correlationId
			},
			correlationId,
			eventType: 'WaitlistJoin',
			aggregateId,
			status: 'pending',
			maxRetries: 3,
			attempts: 0
		};
		const outboxMessage = await OutboxMessage.createOutboxMessage(outboxMessageData);
		info('[joinWaitlistProxy] outbox message created for waitlist.join', { messageId, eventId });
		// Publish immediately (schedular may not be running); outbox stays for retries if publish fails
		try {
			await messageConsumer.publishToExchange(
				exchangeName,
				outboxMessageData.routingKey,
				outboxMessageData.messageBody,
				{
					exchangeType: 'topic',
					publishOptions: {
						messageId,
						correlationId,
						contentType: 'application/json',
						headers: outboxMessageData.headers
					}
				}
			);
			await OutboxMessage.markMessageAsSent(outboxMessage._id);
			info('[joinWaitlistProxy] waitlist.join published and outbox marked sent', { messageId });
		} catch (publishErr) {
			error('[joinWaitlistProxy] failed to publish waitlist.join', { messageId, err: publishErr.message });
			await OutboxMessage.markMessageAsFailed(outboxMessage._id, publishErr.message).catch(() => {});
			// Still return 200: intent is recorded in outbox, schedular will retry
		}
		// Send confirmation email (locale from body/query/Accept-Language)
		try {
			const locale = commonUtil.extractLocaleFromRequest(req);
			const eventTitle = doc.eventTitle || event?.eventTitle || 'Event';
			const eventPromotionalPhoto = doc.eventPromotionPhoto || doc.eventPromotionalPhoto || event?.eventPromotionPhoto || event?.eventPromotionalPhoto;
			const emailHtml = await commonUtil.loadWaitlistJoinedTemplate(eventTitle, locale, {
				eventPromotionalPhoto: eventPromotionalPhoto || undefined
			});
			const { getEmailSubject } = await import('../util/emailTranslations.js');
			const emailSubject = await getEmailSubject('waitlist_joined', locale, {
				companyName: process.env.COMPANY_TITLE || 'Finnep',
				eventTitle
			});
			const { queueGenericEmail } = await import('../workers/emailWorker.js');
			await queueGenericEmail({
				from: process.env.EMAIL_USERNAME,
				to: normalizedEmail,
				subject: emailSubject,
				html: emailHtml
			});
		} catch (emailErr) {
			error('[joinWaitlistProxy] failed to queue confirmation email', { err: emailErr?.message });
		}
		return res.status(consts.HTTP_STATUS_OK).json({ message: 'Joined waitlist' });
	} catch (err) {
		error('joinWaitlistProxy:', err);
		const status = err.status === 404 ? consts.HTTP_STATUS_RESOURCE_NOT_FOUND : consts.HTTP_STATUS_INTERNAL_SERVER_ERROR;
		return res.status(status).json({ error: err.message || INTERNAL_SERVER_ERROR });
	}
};

/**
 * GET /survey/:surveyId - get survey (public).
 * - If surveyId is MongoDB ObjectId (24 hex): load by _id, no eventId required. Link from email uses this.
 * - Else legacy: eventId query required, load by externalSurveyId + externalEventId.
 */
export const getSurveyProxy = async (req, res, next) => {
	try {
		const surveyId = req.params.surveyId;
		const token = req.query.token;
		const surveyIdStr = typeof surveyId === 'string' ? surveyId.trim() : String(surveyId);
		if (!surveyIdStr) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Invalid surveyId' });
		}

		let doc;
		let tokenPayload = null;
		if (isMongoId(surveyIdStr)) {
			if (token) {
				const redisClient = (await import('../model/redisConnect.js')).default;
				tokenPayload = await getSurveyTokenPayload(redisClient, token);
				// 403: invalid/expired link = access refused (not 401 auth failure)
				if (!tokenPayload) {
					return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({ error: 'Invalid or expired survey link. Please use the link from your email.' });
				}
				if (tokenPayload.surveyId !== surveyIdStr) {
					return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Token does not match survey' });
				}
			}
			doc = await Survey.findById(surveyIdStr).lean();
		}
        /*
        else {
			if (!eventId) {
				return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'eventId query required when surveyId is not a Mongo id' });
			}
			const externalEventId = typeof eventId === 'string' ? eventId.trim() : String(eventId);
			if (!externalEventId) {
				return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Invalid eventId' });
			}
			if (token) {
				const redisClient = (await import('../model/redisConnect.js')).default;
				const payload = await getSurveyTokenPayload(redisClient, token);
				if (!payload) {
					return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({ error: 'Invalid or expired survey link. Please use the link from your email.' });
				}
				if (payload.surveyId !== surveyIdStr || (payload.eventId && payload.eventId !== externalEventId)) {
					return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Token does not match survey or event' });
				}
			}
			doc = await Survey.findOne({ externalSurveyId: surveyIdStr, externalEventId }).lean();
		}
            */

		if (!doc) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND });
		}
		const survey = {
			id: doc._id.toString(),
			name: doc.name || '',
			questions: doc.questions || [],
			active: doc.active !== false,
			merchantId: doc.merchantId,
			eventId: doc.externalEventId != null ? doc.externalEventId : undefined,
			submitted: !!tokenPayload?.used
		};
		if (doc.externalEventId && doc.merchantId) {
			const [eventDoc, merchantDoc] = await Promise.all([
				Event.getEventByExternalIds(doc.merchantId, doc.externalEventId),
				Merchant.getMerchantByMerchantId(doc.merchantId)
			]);
			const eventTitle = eventDoc?.eventTitle ?? null;
			const eventDate = eventDoc?.eventDate ? (eventDoc.eventDate instanceof Date ? eventDoc.eventDate.toISOString() : eventDoc.eventDate) : null;
			const merchantName = merchantDoc?.name ?? null;
			if (eventTitle != null || eventDate != null || merchantName != null) {
				survey.context = { eventTitle, eventDate, merchantName };
			}
		}
		return res.status(consts.HTTP_STATUS_OK).json(survey);
	} catch (err) {
		error('getSurveyProxy:', err);
		const status = err.status === 404 ? consts.HTTP_STATUS_RESOURCE_NOT_FOUND : consts.HTTP_STATUS_INTERNAL_SERVER_ERROR;
		return res.status(status).json({ error: err.message || INTERNAL_SERVER_ERROR });
	}
};

/**
 * POST /survey/:surveyId/response - submit survey response (public). Body: { token, respondent_identifier?, responses }. eventId only for legacy external-id links.
 * Consumes token (one-time), saves to MongoDB, then publishes to RabbitMQ; event-merchant-service persists to Postgres.
 */
export const submitSurveyResponseProxy = async (req, res, next) => {
	try {
		const surveyId = req.params.surveyId;
		const { eventId, token, respondent_identifier, responses } = req.body || {};
		if (!token || typeof token !== 'string') {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'token required in body (from survey link)' });
		}
		if (!responses || typeof responses !== 'object') {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'responses object required' });
		}
		const surveyIdStr = typeof surveyId === 'string' ? surveyId.trim() : String(surveyId);
		if (!surveyIdStr) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Invalid surveyId' });
		}

		const redisClient = (await import('../model/redisConnect.js')).default;
		const payload = await consumeSurveyToken(redisClient, token);
		// 403: invalid/expired/used link = access refused (not 401 auth failure)
		if (!payload) {
			return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({ error: 'Invalid or expired survey link. This link has already been used or has expired.' });
		}
		if (payload.surveyId !== surveyIdStr) {
			return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'Token does not match survey' });
		}

		let surveyDoc;
		if (isMongoId(surveyIdStr)) {
			surveyDoc = await Survey.findById(surveyIdStr).lean();
		} else {
			const externalEventId = eventId != null && typeof eventId === 'string' ? eventId.trim() : String(eventId || '');
			if (!externalEventId) {
				return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ error: 'eventId required in body when surveyId is not a Mongo id' });
			}
			surveyDoc = await Survey.findOne({ externalSurveyId: surveyIdStr, externalEventId }).lean();
		}

		if (!surveyDoc) {
			return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ error: RESOURCE_NOT_FOUND });
		}
		const merchantId = surveyDoc.merchantId;
		const externalSurveyId = surveyDoc.externalSurveyId;
		const externalEventId = surveyDoc.externalEventId != null ? surveyDoc.externalEventId : null;
		await SurveyResponse.create({
			merchantId,
			externalSurveyId,
			externalEventId,
			respondentIdentifier: respondent_identifier ?? payload.recipientIdentifier ?? null,
			responses: responses || {}
		});
		const exchangeName = process.env.RABBITMQ_EXCHANGE || 'event-merchant-exchange';
		const messageId = uuidv4();
		await messageConsumer.publishToExchange(exchangeName, 'survey.response.submit', {
			merchant_id: merchantId,
			survey_id: externalSurveyId,
			respondent_identifier: respondent_identifier ?? payload.recipientIdentifier ?? null,
			responses: responses || {}
		}, { exchangeType: 'topic', publishOptions: { messageId } });
		return res.status(consts.HTTP_STATUS_OK).json({ message: 'Response submitted' });
	} catch (err) {
		error('submitSurveyResponseProxy:', err);
		const status = err.status === 404 ? consts.HTTP_STATUS_RESOURCE_NOT_FOUND : consts.HTTP_STATUS_INTERNAL_SERVER_ERROR;
		return res.status(status).json({ error: err.message || INTERNAL_SERVER_ERROR });
	}
};

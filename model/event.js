import * as model from '../model/mongoModel.js'
import {error} from './logger.js'
import { Ticket } from '../model/mongoModel.js'
import { buildCountryMatchFilter } from '../util/regionalAccess.js'
import mongoose from 'mongoose'
import { parseAvailableHeadcount } from '../util/ticketQuantity.js'

const buildValidityWindowFilter = (now) => ([
    { event_end_date: { $gte: now } },
    { eventEndDate: { $gte: now } },
    { eventDate: { $gte: now } },
    { status: 'on-going' },
]);
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const effectiveEventEndDateExpr = {
    $ifNull: ['$event_end_date', { $ifNull: ['$eventEndDate', '$eventDate'] }]
}

/** Same end-date fallback as silo storefront partitionEvents. */
export const getEventEffectiveEndDate = (event) => {
    const raw = event?.event_end_date ?? event?.eventEndDate ?? event?.eventDate
    if (!raw) return null
    const end = raw instanceof Date ? raw : new Date(raw)
    return Number.isNaN(end.getTime()) ? null : end
}

export const isEventPastByEndDate = (event, now = new Date()) => {
    const end = getEventEffectiveEndDate(event)
    if (!end) return false
    return end.getTime() < now.getTime()
}

const buildPartnerMerchantEventsQuery = ({ city, country, merchantId, now = new Date() }) => {
    const q = {
        merchant: merchantId,
        $or: [
            { active: { $ne: false } },
            {
                active: false,
                $expr: { $lt: [effectiveEventEndDateExpr, now] }
            }
        ]
    }
    if (city) {
        q.city = city
    }
    if (country) {
        q.country = new RegExp(`^${escapeRegExp(String(country).trim())}$`, 'i')
    }
    return q
}

export class Event {

    constructor(eventTitle, eventDescription, eventDate,
        occupancy,ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
        eventLocationGeoCode, transportLink,
        socialMedia, lang, position, active, eventName, videoUrl, otherInfo,
        eventTimezone, city, country, venueInfo, externalMerchantId, merchant,
        externalEventId, venue, waitlistConfig, event_end_date, isSeatedEvent, shortCode,
        stripeCurrency
    ) {
        this.eventTitle = eventTitle
        this.eventDescription = eventDescription
        this.eventDate = eventDate
        this.occupancy = occupancy
        this.ticketInfo = ticketInfo
        this.eventPromotionPhoto = eventPromotionPhoto
        this.eventPhoto = eventPhoto
        this.eventLocationAddress = eventLocationAddress
        this.eventLocationGeoCode = eventLocationGeoCode
        this.transportLink = transportLink
        this.socialMedia = socialMedia
        this.lang = lang
        this.position = position
        this.active = active
        this.eventName = eventName
        this.videoUrl = videoUrl
        this.otherInfo = otherInfo
        this.eventTimezone = eventTimezone
        this.city = city
        this.country = country
        this.venueInfo = venueInfo
        this.externalMerchantId = externalMerchantId
        this.merchant = merchant
        this.externalEventId = externalEventId
        this.venue = venue
        this.waitlistConfig = waitlistConfig
        this.event_end_date = event_end_date
        this.isSeatedEvent = isSeatedEvent
        this.shortCode = shortCode
        this.stripeCurrency = stripeCurrency
    }
    async saveToDB() {
        try {
            // Validate pricingModel when hasSeatSelection is true
            if (this.venue && this.venue.hasSeatSelection === true) {
                if (!this.venue.pricingModel || (this.venue.pricingModel !== 'ticket_info' && this.venue.pricingModel !== 'pricing_configuration')) {
                    throw new Error('pricingModel must be set to either "ticket_info" or "pricing_configuration" when hasSeatSelection is true');
                }
            } else if (this.venue && this.venue.hasSeatSelection === false) {
                // Default to 'ticket_info' when hasSeatSelection is false
                if (!this.venue.pricingModel) {
                    this.venue.pricingModel = 'ticket_info';
                }
            }

            const event = new model.Event({
                eventTitle: this.eventTitle,
                eventDescription: this.eventDescription,
                eventDate: this.eventDate,
                occupancy: this.occupancy,
                ticketInfo:this.ticketInfo,
                eventPromotionPhoto: this.eventPromotionPhoto,
                eventPhoto: this.eventPhoto,
                eventLocationAddress: this.eventLocationAddress,
                eventLocationGeoCode: this.eventLocationGeoCode,
                transportLink: this.transportLink,
                socialMedia: this.socialMedia,
                lang: this.lang,
                position: this.position,
                active: this.active,
                eventName: this.eventName,
                videoUrl: this.videoUrl,
                otherInfo: this.otherInfo,
                eventTimezone: this.eventTimezone,
                city: this.city,
                country: this.country,
                venueInfo: this.venueInfo,
                externalMerchantId: this.externalMerchantId,
                merchant: this.merchant,
                externalEventId: this.externalEventId,
                venue: this.venue,
                waitlistConfig: this.waitlistConfig,
                event_end_date: this.event_end_date,
                isSeatedEvent: this.isSeatedEvent,
                shortCode: this.shortCode,
                ...(this.stripeCurrency ? { stripeCurrency: this.stripeCurrency } : {}),
            })
            return await event.save()
        } catch (err) {
            error('error creating event %s', err.stack)
            throw err
        }

    }
}

export const createEvent = async (eventTitle, eventDescription, eventDate,
    occupancy, ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
    socialMedia, lang, position, active, eventName, videoUrl, otherInfo,
    eventTimezone, city, country, venueInfo, externalMerchantId, merchant, externalEventId, venue,     waitlistConfig, event_end_date, isSeatedEvent, shortCode, stripeCurrency
    ) =>{

    const event = new Event(eventTitle, eventDescription, eventDate,
        occupancy, ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
        socialMedia, lang, position, active, eventName, videoUrl, otherInfo,
        eventTimezone, city, country, venueInfo, externalMerchantId, merchant, externalEventId, venue, waitlistConfig, event_end_date, isSeatedEvent, shortCode, stripeCurrency)
    return await event.saveToDB()
}

export const getEvents = async(page = 1, limit = 10, filters = {}) =>{
    const skip = (page - 1) * limit

    // Build query filter object
    const queryFilter = {}

    if (filters.country) {
        queryFilter.country = new RegExp(`^${escapeRegExp(String(filters.country).trim())}$`, 'i')
    } else if (filters.allowedCountryCodes) {
        const countryFilter = buildCountryMatchFilter(filters.allowedCountryCodes)
        if (countryFilter) {
            queryFilter.country = countryFilter
        }
    }

    if (filters.merchantId) {
        queryFilter.merchant = filters.merchantId
    }

    if (filters.category) {
        queryFilter['otherInfo.categoryName'] = filters.category
    }

    // CMS listing must include full lifecycle events (active/inactive/past).

    // Get total count for pagination metadata with filters
    const total = await model.Event.countDocuments(queryFilter).exec()

    // Get paginated events with filters
    const events = await model.Event.find(queryFilter)
        .populate('merchant')
        .sort({eventDate:-1})
        .skip(skip)
        .limit(limit)
        .exec()

    const totalPages = Math.ceil(total / limit)

    return {
        events: events.map(event => ({
            ...event.toObject(),
            eventPhoto: []
        })),
        pagination: {
            currentPage: page,
            totalPages,
            totalItems: total,
            itemsPerPage: limit,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        }
    }
}

export const getAllEventsForDashboard = async() => {
    // Dashboard only needs a small subset of fields; avoid heavy populate/toObject work.
    const events = await model.Event.find({})
        .populate('merchant')
        .sort({eventDate:-1})
        .exec()

    return events.map(event => ({
        ...event.toObject(),
        eventPhoto: []
    }))
}

export const getEventFilterOptions = async(filters = {}) => {
    try {
        const queryFilter = {}
        if (filters.allowedCountryCodes) {
            const countryFilter = buildCountryMatchFilter(filters.allowedCountryCodes)
            if (countryFilter) {
                queryFilter.country = countryFilter
            }
        }

        // Get all unique countries
        const countries = await model.Event.distinct('country', queryFilter).exec()
        const countriesList = countries.filter(c => c && c.trim() !== '').sort()

        // Get all unique merchants
        const merchantIds = await model.Event.distinct('merchant', queryFilter).exec()
        const merchants = await model.Merchant.find({ _id: { $in: merchantIds } })
            .select('_id name')
            .sort({ name: 1 })
            .exec()

        return {
            countries: countriesList,
            merchants: merchants.map(m => ({
                _id: m._id,
                name: m.name
            }))
        }
    } catch (err) {
        error('error getting filter options', err)
        return {
            countries: [],
            merchants: []
        }
    }
}

export const getEventById = async(id) =>{
    return await model.Event.findById({_id:id}).populate('merchant').exec()
}

export const getEventByExternalEventId = async(externalEventId) =>{
    return await model.Event.findOne({externalEventId:externalEventId}).exec()
}

export const getEventByExternalIds = async (externalMerchantId, externalEventId) => {
    return await model.Event.findOne({
        externalMerchantId: String(externalMerchantId),
        externalEventId: String(externalEventId)
    }).populate('merchant').exec();
}

/**
 * Atomically decrement ticket type available headcount (admission units, not pack count).
 * Skips when ticket type has no available cap in Mongo.
 */
export const decrementTicketTypeAvailable = async (eventId, ticketTypeId, admissionQuantity, ticketTypeConfig = null) => {
    const qty = parseInt(String(admissionQuantity), 10);
    if (!ticketTypeId || !Number.isFinite(qty) || qty < 1) {
        return { success: false, reason: 'invalid_args' };
    }

    if (ticketTypeConfig && parseAvailableHeadcount(ticketTypeConfig) == null) {
        return { success: true, skipped: true };
    }

    const ticketTypeObjectId = new mongoose.Types.ObjectId(ticketTypeId);

    const updated = await model.Event.findOneAndUpdate(
        {
            _id: eventId,
            ticketInfo: {
                $elemMatch: {
                    _id: ticketTypeObjectId,
                    available: { $gte: qty }
                }
            }
        },
        { $inc: { 'ticketInfo.$.available': -qty } },
        { new: true }
    ).exec();

    if (!updated) {
        return { success: false, reason: 'insufficient_inventory' };
    }

    const ticketType = updated.ticketInfo?.find((t) => String(t._id) === String(ticketTypeId));
    if (ticketType && ticketType.available <= 0) {
        const status = ticketType.status;
        if (status !== 'inactive' && status !== 'disabled') {
            await model.Event.updateOne(
                { _id: eventId, 'ticketInfo._id': ticketTypeObjectId },
                { $set: { 'ticketInfo.$.status': 'sold_out' } }
            ).exec();
        }
    }

    return { success: true, admissionQuantity: qty };
};

/**
 * Atomically increment ticket type available headcount (refund / cancellation reversal).
 */
export const incrementTicketTypeAvailable = async (eventId, ticketTypeId, admissionQuantity, ticketTypeConfig = null) => {
    const qty = parseInt(String(admissionQuantity), 10);
    if (!ticketTypeId || !Number.isFinite(qty) || qty < 1) {
        return { success: false, reason: 'invalid_args' };
    }

    if (ticketTypeConfig && parseAvailableHeadcount(ticketTypeConfig) == null) {
        return { success: true, skipped: true };
    }

    const ticketTypeObjectId = new mongoose.Types.ObjectId(ticketTypeId);

    const updated = await model.Event.findOneAndUpdate(
        {
            _id: eventId,
            'ticketInfo._id': ticketTypeObjectId
        },
        { $inc: { 'ticketInfo.$.available': qty } },
        { new: true }
    ).exec();

    if (!updated) {
        return { success: false, reason: 'ticket_type_not_found' };
    }

    const ticketType = updated.ticketInfo?.find((t) => String(t._id) === String(ticketTypeId));
    if (ticketType && ticketType.status === 'sold_out' && ticketType.available > 0) {
        await model.Event.updateOne(
            { _id: eventId, 'ticketInfo._id': ticketTypeObjectId },
            { $set: { 'ticketInfo.$.status': 'active' } }
        ).exec();
    }

    return { success: true, admissionQuantity: qty };
};

export const decrementCouponUsesLeft = async (eventMongoId, couponCode) => {
    const normalized = String(couponCode || '').trim().toUpperCase();
    if (!eventMongoId || !normalized) {
        return { ok: false };
    }
    const updated = await model.Event.findOneAndUpdate(
        {
            _id: eventMongoId,
            discountCodes: {
                $elemMatch: {
                    code: { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                    uses_left: { $gt: 0 },
                    active: { $ne: false }
                }
            }
        },
        { $inc: { 'discountCodes.$[elem].uses_left': -1 } },
        {
            arrayFilters: [{
                'elem.code': { $regex: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
                'elem.uses_left': { $gt: 0 }
            }],
            new: true
        }
    ).lean().exec();

    return { ok: !!updated, event: updated };
};

export const updateEventById = async (id, obj) =>{
    const setPayload = Object.fromEntries(
        Object.entries(obj).filter(([, value]) => value !== undefined)
    );
    try {
        return await model.Event.findByIdAndUpdate(id, {
            $set: setPayload
        }, { new: true }).lean().exec();
    } catch (error) {
        if (error.code === 11000) {
            const conflict = JSON.stringify(error.keyValue || {});
            throw new Error(`Event update failed: duplicate key on ${conflict}. Check legacy unique indexes on events collection.`);
        }
        throw error;
    }
}

export const getEventsWithTicketCounts = async() =>{
    try{
        // Use the new positioning system
        const events = await getEventsWithPositioning();
        // Clean up the events (ticket counts already included from getEventsWithPositioning)
        const eventsWithTicketCounts = events.map(event => {
            const { ...cleanedEvent } = event;
            return {
                ...cleanedEvent,
                eventPhoto: [] // Remove event photos for performance
            };
        });

        return eventsWithTicketCounts;
    }catch(err){
        throw err
    }
}

export const deleteEventById = async(id) =>{
    // Update to delete only if active is false
    return await model.Event.findOneAndDelete({ _id: id, active: false });
}


export const listEvent = async(filter) =>{
    // Return events that are still valid.
    const now = new Date();
    return await model.Event.find({
        active: true,
        $or: buildValidityWindowFilter(now)
    }).populate('merchant').sort({'position':-1}).lean()
}

/** Single aggregation to get active ticket counts per event (avoids N+1). Returns { [eventIdStr]: count }. */
async function getTicketCountsByEventIds(eventIds) {
    if (!eventIds || eventIds.length === 0) return {};
    const counts = await Ticket.aggregate([
        { $match: { active: true, event: { $in: eventIds } } },
        { $group: { _id: '$event', count: { $sum: 1 } } }
    ]);
    const map = {};
    for (const c of counts) {
        map[c._id.toString()] = c.count;
    }
    return map;
}

export const listEventFiltered = async({ city, country, page = 1, limit = 1000, merchantId } = {}) => {
    const q = {
        active: true
    }
    if (city) {
        q.city = city
    }
    if (country) {
        q.country = new RegExp(`^${escapeRegExp(String(country).trim())}$`, 'i')
    }
    if (merchantId) {
        q.merchant = merchantId
    }

    // Return events that are still valid.
    const now = new Date();
    q.$or = buildValidityWindowFilter(now)

    const numericPage = Math.max(parseInt(String(page), 10) || 1, 1)
    const numericLimit = Math.min(Math.max(parseInt(String(limit), 10) || 1000, 1), limit)

    const total = await model.Event.countDocuments(q)
    const items = await model.Event.find(q)
        .populate('merchant')
        .sort({ eventDate: 1 })
        .skip((numericPage - 1) * numericLimit)
        .limit(numericLimit)
        .lean()

    const eventIds = items.map((e) => e._id)
    const countByEventId = await getTicketCountsByEventIds(eventIds)
    const itemsWithCounts = items.map((event) => ({
        ...event,
        ticketsSold: countByEventId[event._id.toString()] || 0
    }))

    return { items: itemsWithCounts, total }
}

/** Merchant events for partner/silo API — inactive upcoming/current hidden; inactive past included. */
export const listPartnerMerchantEvents = async({ city, country, page = 1, limit = 50, merchantId } = {}) => {
    if (!merchantId) {
        return { items: [], total: 0 }
    }

    const q = buildPartnerMerchantEventsQuery({ city, country, merchantId })

    const numericPage = Math.max(parseInt(String(page), 10) || 1, 1)
    const numericLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200)

    const total = await model.Event.countDocuments(q)
    const items = await model.Event.find(q)
        .populate('merchant')
        .sort({ eventDate: -1 })
        .skip((numericPage - 1) * numericLimit)
        .limit(numericLimit)
        .lean()

    const eventIds = items.map((e) => e._id)
    const countByEventId = await getTicketCountsByEventIds(eventIds)
    const itemsWithCounts = items.map((event) => ({
        ...event,
        ticketsSold: countByEventId[event._id.toString()] || 0
    }))

    return { items: itemsWithCounts, total }
}

// Featured events methods
export const getFeaturedEvents = async() => {
    try {
        const now = new Date();
        const featuredEvents = await model.Event.find({
            active: true,
            'featured.isFeatured': true,
            $or: [
                { 'featured.featuredType': 'sticky' },
                {
                    'featured.featuredType': 'temporary',
                    'featured.startDate': { $lte: now },
                    'featured.endDate': { $gte: now }
                }
            ],
            $and: [
                { $or: buildValidityWindowFilter(now) }
            ]
        })
        .populate('merchant')
        .sort({
            'featured.priority': -1,
            'featured.position': 1,
            'featured.featuredAt': -1
        })
        .lean();

        return featuredEvents;
    } catch (error) {
        console.error('Error getting featured events:', error);
        return [];
    }
}

export const getRegularEvents = async(skipFeaturedIds = []) => {
    try {
        const now = new Date();
        const regularEvents = await model.Event.find({
            active: true,
            $or: [
                { 'featured.isFeatured': false },
                { 'featured.isFeatured': { $exists: false } }
            ],
            $and: [
                { $or: buildValidityWindowFilter(now) }
            ],
            _id: { $nin: skipFeaturedIds }
        })
        .populate('merchant')
        .sort({ position: -1, createdAt: -1 })
        .lean();

        return regularEvents;
    } catch (error) {
        console.error('Error getting regular events:', error);
        return [];
    }
}

export const getEventsWithPositioning = async() => {
    try {
        const [featuredEvents, regularEvents] = await Promise.all([
            getFeaturedEvents(),
            getRegularEvents()
        ]);

        // Combine and sort: featured first, then regular
        const allEvents = [...featuredEvents, ...regularEvents];

        const eventIds = allEvents.map((e) => e._id)
        const countByEventId = await getTicketCountsByEventIds(eventIds)
        const eventsWithTicketCounts = allEvents.map((event) => ({
            ...event,
            ticketsSold: countByEventId[event._id.toString()] || 0
        }));

        return eventsWithTicketCounts;
    } catch (error) {
        console.error('Error getting events with positioning:', error);
        return [];
    }
}

export const featureEvent = async(eventId, featuredData, userId) => {
    try {
        const updateData = {
            'featured.isFeatured': true,
            'featured.featuredType': featuredData.type || 'temporary',
            'featured.priority': featuredData.priority || 0,
            'featured.reason': featuredData.reason,
            'featured.createdBy': userId,
            'featured.featuredAt': new Date()
        };

        // Add time-based fields for temporary featuring
        if (featuredData.type === 'temporary') {
            updateData['featured.startDate'] = featuredData.startDate;
            updateData['featured.endDate'] = featuredData.endDate;
        }

        const event = await model.Event.findByIdAndUpdate(
            eventId,
            { $set: updateData },
            { new: true }
        ).populate('merchant');

        return event;
    } catch (error) {
        console.error('Error featuring event:', error);
        throw error;
    }
}

export const unfeatureEvent = async(eventId) => {
    try {
        const event = await model.Event.findByIdAndUpdate(
            eventId,
            {
                $set: {
                    'featured.isFeatured': false,
                    'featured.featuredType': 'temporary',
                    'featured.priority': 0,
                    'featured.reason': null,
                    'featured.startDate': null,
                    'featured.endDate': null
                }
            },
            { new: true }
        ).populate('merchant');

        return event;
    } catch (error) {
        console.error('Error unfeaturing event:', error);
        throw error;
    }
}

export const cleanupExpiredFeatures = async() => {
    try {
        const now = new Date();
        const result = await model.Event.updateMany(
            {
                'featured.isFeatured': true,
                'featured.featuredType': 'temporary',
                'featured.endDate': { $lt: now }
            },
            {
                $set: {
                    'featured.isFeatured': false,
                    'featured.featuredType': 'temporary',
                    'featured.priority': 0,
                    'featured.reason': 'Expired temporary feature',
                    'featured.endDate': null
                }
            }
        );

        console.log(`Cleaned up ${result.modifiedCount} expired featured events`);
        return result.modifiedCount;
    } catch (error) {
        console.error('Error cleaning up expired features:', error);
        throw error;
    }
}

// find by index
export const getEventByMerchantAndExternalId = async(externalMerchantId, externalEventId) => {
    try {
        return await model.Event.findOne({
            externalMerchantId: externalMerchantId,
            externalEventId: externalEventId
        }).populate('merchant').lean().exec();
    } catch (error) {
        console.error('Error finding event by merchant and external ID:', error);
        throw error;
    }
}


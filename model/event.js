import * as model from '../model/mongoModel.js'
import {error} from './logger.js'
import { Ticket } from '../model/mongoModel.js'
export class Event {

    constructor(eventTitle, eventDescription, eventDate,
        occupancy,ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress,
        eventLocationGeoCode, transportLink,
        socialMedia, lang, position, active, eventName, videoUrl, otherInfo,
        eventTimezone, city, country, venueInfo, externalMerchantId, merchant,
        externalEventId,venue,
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
    }
    async saveToDB() {
        try {

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
    eventTimezone, city, country, venueInfo, externalMerchantId, merchant, externalEventId, venue
    ) =>{

    const event = new Event(eventTitle, eventDescription, eventDate,
        occupancy, ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
        socialMedia, lang, position, active, eventName, videoUrl, otherInfo,
        eventTimezone, city, country, venueInfo, externalMerchantId, merchant, externalEventId, venue)
    return await event.saveToDB()
}

export const getEvents = async(page = 1, limit = 10, filters = {}) =>{
    const skip = (page - 1) * limit

    // Build query filter object
    const queryFilter = {}

    if (filters.country) {
        queryFilter.country = filters.country
    }

    if (filters.merchantId) {
        queryFilter.merchant = filters.merchantId
    }

    if (filters.category) {
        queryFilter['otherInfo.categoryName'] = filters.category
    }

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
    // Get all events without pagination for dashboard
    const events = await model.Event.find({})
        .populate('merchant')
        .sort({eventDate:-1})
        .exec()

    return events.map(event => ({
        ...event.toObject(),
        eventPhoto: []
    }))
}

export const getEventFilterOptions = async() => {
    try {
        // Get all unique countries
        const countries = await model.Event.distinct('country').exec()
        const countriesList = countries.filter(c => c && c.trim() !== '').sort()

        // Get all unique merchants
        const merchantIds = await model.Event.distinct('merchant').exec()
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

export const updateEventById = async (id, obj) =>{
    try {
        return await model.Event.findByIdAndUpdate(id, {
            $set: obj
        }, { new: true }).lean().exec();
    } catch (error) {
        // Handle duplicate key errors gracefully
        if (error.code === 11000) {
            console.warn(`Duplicate key error when updating event ${id}:`, error.keyValue);
            // Try to find the existing event and return it instead of throwing
            return await model.Event.findById(id).lean().exec();
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
    // Only return future events
    const now = new Date();
    return await model.Event.find({
        eventDate: { $gte: now }
    }).populate('merchant').sort({'position':-1}).lean()
}

export const listEventFiltered = async({ city, country, page = 1, limit = 12 } = {}) => {
    const q = {}
    if (city) {
        q.city = city
    }
    if (country) {
        q.country = country
    }
    // Active only by default
    q.active = { $ne: false }

    // Only return future events
    const now = new Date();
    q.eventDate = { $gte: now }

    const numericPage = Math.max(parseInt(String(page), 10) || 1, 1)
    const numericLimit = Math.min(Math.max(parseInt(String(limit), 10) || 12, 1), 100)

    const total = await model.Event.countDocuments(q)
    const items = await model.Event.find(q)
        .populate('merchant')
        .sort({ eventDate: 1 })
        .skip((numericPage - 1) * numericLimit)
        .limit(numericLimit)
        .lean()

    // append ticketsSold like getEventsWithTicketCounts does
    const itemsWithCounts = await Promise.all(items.map(async (event) => {
        const ticketsSold = await Ticket.countDocuments({ active: true, event: event._id })
        const {  ...cleaned } = event
        return { ...cleaned, ticketsSold }
    }))

    return { items: itemsWithCounts, total }
}

// Featured events methods
export const getFeaturedEvents = async() => {
    try {
        const now = new Date();
        const featuredEvents = await model.Event.find({
            'featured.isFeatured': true,
            $or: [
                { 'featured.featuredType': 'sticky' },
                {
                    'featured.featuredType': 'temporary',
                    'featured.startDate': { $lte: now },
                    'featured.endDate': { $gte: now }
                }
            ],
            active: true,
            eventDate: { $gte: now } // Only future events
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
            $or: [
                { 'featured.isFeatured': false },
                { 'featured.isFeatured': { $exists: false } }
            ],
            active: true,
            eventDate: { $gte: now },
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

        // Add ticket counts
        const eventsWithTicketCounts = await Promise.all(
            allEvents.map(async (event) => {
                const ticketsSold = await Ticket.countDocuments({
                    active: true,
                    event: event._id
                });

                return {
                    ...event,
                    ticketsSold
                };
            })
        );

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


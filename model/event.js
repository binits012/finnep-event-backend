 
import * as model from '../model/mongoModel.js'
import {error} from './logger.js'
import { Ticket } from '../model/mongoModel.js'
export class Event {
    constructor(eventTitle, eventDescription, eventDate,  
        occupancy,ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
        socialMedia, lang, position, active, eventName, videoUrl) {
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
                videoUrl: this.videoUrl
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
    socialMedia, lang, position, active, eventName, videoUrl) =>{
        
    const event = new Event(eventTitle, eventDescription, eventDate,  
        occupancy, ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
        socialMedia, lang, position, active, eventName, videoUrl)
    return await event.saveToDB()
}

export const getEvents = async() =>{
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return await model.Event.find({}).sort({eventDate:-1}).exec() 
}

export const getEventById = async(id) =>{ 
    return await model.Event.findById({_id:id}).exec()
}
export const updateEventById = async (id, obj) =>{
    return await model.Event.findByIdAndUpdate(id, {
        $set: obj
    }, { new: true })  
}

export const getEventsWithTicketCounts = async() =>{
    try{ 
        const events = await model.Event.find({}).lean()  // `.lean()` for plain JS objects instead of Mongoose models
        const eventsWithTicketCounts = await Promise.all(
        events.map(async (event) => {
            const ticketsSold = await Ticket.countDocuments({ 
            active: true,      // Count only active tickets
            event:event._id
            })

            return {
            ...event,
            ticketsSold  // Add ticket count info to the event
            }
        }))

        return eventsWithTicketCounts;
    }catch(err){
        throw err
    }
}
 
 
import * as model from '../model/mongoModel.js'
import {error} from './logger.js'

export class Event {
    constructor(eventTitle, eventDescription, eventDate, eventTime, eventPrice,
        occupancy, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
        socialMedia, lang, position, active, eventName, videoUrl) {
        this.eventTitle = eventTitle
        this.eventDescription = eventDescription
        this.eventDate = eventDate
        this.eventTime = eventTime
        this.eventPrice = eventPrice
        this.occupancy = occupancy
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
                eventTime: this.eventTime,
                eventPrice: this.eventPrice,
                occupancy: this.occupancy,
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

export const createEvent = async (eventTitle, eventDescription, eventDate, eventTime,  eventPrice, 
    occupancy, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
    socialMedia, lang, position, active, eventName, videoUrl) =>{
        
    const event = new Event(eventTitle, eventDescription, eventDate, eventTime,  eventPrice, 
        occupancy, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
        socialMedia, lang, position, active, eventName, videoUrl)
    return await event.saveToDB()
}

export const getEvents = async() =>{
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return await model.Event.find({eventDate:{$gte:today}}).sort({position:1}).sort({eventDate:-1}).exec() 
}

export const getEventById = async(id) =>{ 
    return await model.Event.findById({_id:id}).exec()
}
export const updateEventById = async (id, obj) =>{
    return await model.Event.findByIdAndUpdate(id, {
        $set: obj
    }, { new: true })  
}
 
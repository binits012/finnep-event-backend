 
(function(){
    const model = require('./mongoModel')

    const Event = (function(){
        const Event = function Event(eventTitle, eventDescription, eventDate, eventTime,  eventPrice, 
            occupancy, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
            socialMedia, lang, position, active,eventName,videoUrl
            ){
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
                this.active =active
                this.eventName = eventName
                this.videoUrl = videoUrl

        }

        Event.prototype.saveToDB = async function(){
            const event = new model.Event({
                eventTitle:this.eventTitle,
                eventDescription:this.eventDescription,
                eventDate:this.eventDate,
                eventTime:this.eventTime, 
                eventPrice:this.eventPrice, 
                occupancy:this.occupancy, 
                eventPromotionPhoto:this.eventPromotionPhoto, 
                eventPhoto:this.eventPhoto, 
                eventLocationAddress:this.eventLocationAddress, 
                eventLocationGeoCode:this.eventLocationGeoCode, 
                transportLink:this.transportLink,
                socialMedia:this.socialMedia, 
                lang:this.lang, 
                position:this.position, 
                active:this.active,
                eventName:this.eventName,
                videoUrl:this.videoUrl
            })
            return  await event.save()
        }
        return Event
    })()

    const createEvent = async (eventTitle, eventDescription, eventDate, eventTime,  eventPrice, 
        occupancy, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
        socialMedia, lang, position, active, eventName, videoUrl) =>{
        const event = new Event(eventTitle, eventDescription, eventDate, eventTime,  eventPrice, 
            occupancy, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
            socialMedia, lang, position, active, eventName, videoUrl)
        return  await event.saveToDB().catch(err=>{
            console.log(err)
            throw err
        })
    }

    const getEvents = async() =>{
        return await model.Event.find().sort({eventDate:-1}).exec() 
    }

    const getEventById = async(id) =>{ 
        return await model.Event.findById({_id:id}).exec()
    }
    const updateEventById = async (id, obj) =>{
        return await model.Event.findByIdAndUpdate(id, {
			$set: obj
		}, { new: true })  
    }

    let root = typeof exports !== 'undefined' && exports !== null ? exports : window
    root.Event = Event
    root.createEvent = createEvent
    root.getEvents = getEvents
    root.updateEventById = updateEventById
    root.getEventById = getEventById
}).call(this)
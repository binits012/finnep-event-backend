import * as jwtToken from '../util/jwtToken.js'
import * as Event from '../model/event.js'
import * as consts from '../const.js'
import {error} from '../model/logger.js'
import * as appText from '../applicationTexts.js'
import * as commonUtil from '../util/common.js'
import * as busboyFileUpload from '../util/busboyFileUpload.js'

export const createEvent = async (req, res, next) =>{
    const token = req.headers.authorization
    const eventTitle = req.body.eventTitle
    const eventDescription = req.body.eventDescription
    const eventDate = req.body.eventDate 
    const occupancy = req.body.occupancy
    const ticketInfo = req.body.ticketInfo
    const eventPromotionPhoto = req.body.eventPromotionPhoto
    const eventPhoto = req.body.eventPhoto
    const eventLocationAddress = req.body.eventLocationAddress
    const eventLocationGeoCode = req.body.eventLocationGeoCode
    const transportLink = req.body.transportLink
    const socialMedia = req.body.socialMedia
    let lang = req.body.lang
    const position = req.body.position
    const active = req.body.active
    const eventName=req.body.eventName
    const videoUrl = req.body.videoUrl
    const otherInfo = req.body.otherInfo

    if(lang === 'undefined' || lang === ""){
        lang = "en"
    }   
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            try{
                const userRoleFromToken = data.role
                if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                    if(!res.headersSent){
                        return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                            message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                        })
                    }
                    
                } 
                await Event.createEvent(eventTitle, eventDescription, eventDate, 
                    occupancy, ticketInfo, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
                    socialMedia, lang, position, active, eventName, videoUrl, otherInfo).then(data=>{
                    return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
                }).catch(err=>{
                    error("error", err.stack)
                    throw err
                }) 
            }catch(err){
                error("error", err.stack)
                if(!res.headersSent){
                    error('error',err)
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, event creation failed', error: err.stack
                    })
                }
            }
            
        }
    })

}

export const getEvents = async(req,res,next)=>{
    const token = req.headers.authorization
    await jwtToken.verifyJWT(token, async (err, data) => {
        if ( err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
             
            await Event.getEvents().then(data=>{
                return res.status(consts.HTTP_STATUS_OK).json({ data: data, timeZone:process.env.TIME_ZONE })
            }).catch(err=>{
                error('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get events failed', error: appText.EVENT_GET_FAILED
                })
            }) 
        }
    })
}

export const getEventById = async (req, res, next) => {
    const token = req.headers.authorization
    const id = req.params.id
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
             
            await Event.getEventById(id).then(data=>{
                return res.status(consts.HTTP_STATUS_OK).json({ data: data,  timeZone:process.env.TIME_ZONE })
            }).catch(err=>{
                error('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get event by id failed', error: appText.EVENT_GET_FAILED
                })
            }) 
        }
    })
}

export const updateEventById = async (req,res,next) =>{

    const token = req.headers.authorization
    const id = req.params.id
    const eventTitle = req.body.eventTitle
    const eventDescription = req.body.eventDescription
    const eventDate = req.body.eventDate  
    const occupancy = req.body.occupancy
    const ticketInfo = req.body.ticketInfo
    const eventPromotionPhoto = req.body.eventPromotionPhoto 
    const eventLocationAddress = req.body.eventLocationAddress
    const eventLocationGeoCode = req.body.eventLocationGeoCode
    const transportLink = req.body.transportLink
    const socialMedia = req.body.socialMedia
    let lang = req.body.lang
    const position = req.body.position
    const active = req.body.active
    const eventName = req.body.eventName
    const videoUrl = req.body.videoUrl
    const convertDateTime = await commonUtil.convertDateTimeWithTimeZone(eventDate)
    const otherInfo = req.body.otherInfo
    //const timeInMinutes =  commonUtil.timeInMinutes(eventTime)
    if(lang === 'undefined' || lang === ""){
        lang = "en"
    } 
    const eventObj = {
        eventTitle: eventTitle,
        eventDescription:eventDescription,
        eventDate:eventDate,  
        occupancy:occupancy,
        ticketInfo:ticketInfo,
        eventPromotionPhoto:eventPromotionPhoto, 
        eventLocationAddress:eventLocationAddress,
        eventLocationGeoCode:eventLocationGeoCode,
        transportLink:transportLink,
        socialMedia:socialMedia,
        lang:lang,
        position:position,
        active:active,
        eventName:eventName,
        videoUrl:videoUrl,
        otherInfo:otherInfo

    }
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights.', error: appText.INSUFFICENT_ROLE
                })
            } 
             
            await Event.updateEventById(id,eventObj).then(data=>{
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err=>{
                error('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, update event failed.', error: err.stack
                })
            }) 
        }
    })
}


export const uploadPhotosForParticularEvent = async (req,res,next) =>{
    const token = req.headers.authorization
    const id = req.params.id
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            //check the event
            const myEvent = await Event.getEventById(id).catch(err=>{
                error('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, given event not found.', error: appText.RESOURCE_NOT_FOUND
                })
            })  
            if(myEvent === null || myEvent === '' || myEvent === 'undefined'){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, update event failed.', error: appText.EVENT_UPDATE_FAILED
                })
            }
            else{ 
                await busboyFileUpload.uploadToS3(myEvent, req, (success, err)=>{
                    if(success){
                        const data = {
                            message:"Request accepted, it will take some time to complete the job. Please keep refreshing the page."
                        }
                        return res.status(consts.HTTP_STATUS_ACCEPTED).json(data)
                    }else{
                        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                            message: 'Sorry, something went wrong.', error: appText.INTERNAL_SERVER_ERROR
                        })
                    }
                })
                
            } 
        }
    })
    
}


export const getAllEventsForDashboard = async () =>{
    return await Event.getEvents()
} 
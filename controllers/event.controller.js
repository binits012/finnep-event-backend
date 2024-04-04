'use strict'
const jwtToken = require('../util/jwtToken')
const Event = require('../model/event')
const consts = require('../const')
const logger = require('../model/logger')
const appText = require('../applicationTexts')
const commonUtil = require('../util/common') 
const busboyFileUpload = require('../util/busboyFileUpload')
const moment = require('moment-timezone')

const createEvent = async (req, res, next) =>{
    const token = req.headers.authorization
    const eventTitle = req.body.eventTitle
    const eventDescription = req.body.eventDescription
    const eventDate = req.body.eventDate
    const eventTime = req.body.eventTime
    const eventPrice = req.body.eventPrice
    const occupancy = req.body.occupancy
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
                const timeInMinutes =  commonUtil.timeInMinutes(eventTime)
                await Event.createEvent(eventTitle, eventDescription, eventDate, timeInMinutes,  eventPrice, 
                    occupancy, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
                    socialMedia, lang, position, active, eventName, videoUrl).then(data=>{
                    return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
                }) 
            }catch(err){
                if(!res.headersSent){
                    logger.log('error',err)
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, event creation failed', error: err.stack
                    })
                }
            }
            
        }
    })

}

const getEvents = async(req,res,next)=>{
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
                return res.status(consts.HTTP_STATUS_CREATED).json({ data: data, timeZone:process.env.TIME_ZONE })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get events failed', error: appText.EVENT_GET_FAILED
                })
            }) 
        }
    })
}

const getEventById = async (req, res, next) => {
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
                return res.status(consts.HTTP_STATUS_CREATED).json({ data: data,  timeZone:process.env.TIME_ZONE })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get event by id failed', error: appText.EVENT_GET_FAILED
                })
            }) 
        }
    })
}

const updateEventById = async (req,res,next) =>{

    const token = req.headers.authorization
    const id = req.params.id
    const eventTitle = req.body.eventTitle
    const eventDescription = req.body.eventDescription
    const eventDate = req.body.eventDate
    const eventTime = req.body.eventTime
    const eventPrice = req.body.eventPrice
    const occupancy = req.body.occupancy
    const eventPromotionPhoto = req.body.eventPromotionPhoto
    const eventPhoto = req.body.eventPhoto
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
    const timeInMinutes =  commonUtil.timeInMinutes(eventTime)
    if(lang === 'undefined' || lang === ""){
        lang = "en"
    } 
    const eventObj = {
        eventTitle: eventTitle,
        eventDescription:eventDescription,
        eventDate:convertDateTime,
        eventTime:timeInMinutes,
        eventPrice:eventPrice,
        occupancy:occupancy,
        eventPromotionPhoto:eventPromotionPhoto,
        eventPhoto:eventPhoto,
        eventLocationAddress:eventLocationAddress,
        eventLocationGeoCode:eventLocationGeoCode,
        transportLink:transportLink,
        socialMedia:socialMedia,
        lang:lang,
        position:position,
        active:active,
        eventName:eventName,
        videoUrl:videoUrl

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
                return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, update event failed.', error: err.stack
                })
            }) 
        }
    })
}


const uploadPhotosForParticularEvent = async (req,res,next) =>{
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
                logger.log('error',err)
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


const getAllEventsForDashboard = async () =>{
    return await Event.getEvents()
}
module.exports = {
    createEvent,
    getEvents,
    getEventById,
    updateEventById,
    uploadPhotosForParticularEvent,
    getAllEventsForDashboard
}
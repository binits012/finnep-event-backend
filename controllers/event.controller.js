'use strict'
const jwtToken = require('../util/jwtToken')
const Event = require('../model/event')
const consts = require('../const')
const logger = require('../model/logger')
const appText = require('../applicationTexts')
const commonUtil = require('../util/common')

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

    if(lang === 'undefined' || lang === ""){
        lang = "en"
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
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            const timeInMinutes =  commonUtil.timeInMinutes(eventTime)
             
            await Event.createEvent(eventTitle, eventDescription, eventDate, timeInMinutes,  eventPrice, 
                occupancy, eventPromotionPhoto, eventPhoto, eventLocationAddress, eventLocationGeoCode, transportLink,
                socialMedia, lang, position, active).then(data=>{
                return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, contact creation failed', error: appText.EVENT_CREATE_FAILED
                })
            }) 
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
                return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, contact creation failed', error: appText.EVENT_CREATE_FAILED
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
                return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, contact creation failed', error: appText.EVENT_CREATE_FAILED
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
 
    const timeInMinutes =  commonUtil.timeInMinutes(eventTime)
    if(lang === 'undefined' || lang === ""){
        lang = "en"
    } 
    const eventObj = {
        eventTitle: eventTitle,
        eventDescription:eventDescription,
        eventDate:eventDate,
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
        active:active

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
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
             
            await Event.updateEventById(id,eventObj).then(data=>{
                return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, contact creation failed', error: appText.EVENT_CREATE_FAILED
                })
            }) 
        }
    })
}

const deleteEventById = async (req, res, next) =>{
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
                return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, contact creation failed', error: appText.EVENT_CREATE_FAILED
                })
            }) 
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
    getAllEventsForDashboard
}
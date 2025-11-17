import * as jwtToken from '../util/jwtToken.js'
import * as Event from '../model/event.js'
import * as consts from '../const.js'
import {info, error} from '../model/logger.js'
import * as appText from '../applicationTexts.js'
import * as commonUtil from '../util/common.js'
import * as busboyFileUpload from '../util/busboyFileUpload.js'
import redisClient from '../model/redisConnect.js'
import { v4 as uuidv4 } from 'uuid'
import * as OutboxMessage from '../model/outboxMessage.js'
import { messageConsumer } from '../rabbitMQ/services/messageConsumer.js'

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
    // Build enhanced otherInfo with additional fields
    const otherInfo = {
        ...(req.body.otherInfo || {}),
        categoryName: req.body.categoryName || req.body.category_name,
        subCategoryName: req.body.subCategoryName || req.body.subcategory_name,
        eventExtraInfo: {
            eventType: req.body.eventType || req.body.event_type,
            doorSaleAllowed: req.body.doorSaleAllowed !== undefined ? req.body.doorSaleAllowed : req.body.door_sale_allowed,
            doorSaleExtraAmount: req.body.doorSaleExtraAmount || req.body.door_sale_extra_amount
        }
    };
    //const convertDateTime = await commonUtil.convertDateTimeWithTimeZone(eventDate)
    const eventTimezone = req.body.eventTimezone
    const city = req.body.city
    const country = req.body.country
    const venueInfo = req.body.venueInfo
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
                    socialMedia, lang, position, active, eventName, videoUrl, otherInfo,
                    eventTimezone, city, country, venueInfo
                ).then(data=>{
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

            // Extract pagination parameters from query string
            const page = parseInt(req.query.page) || 1
            const limit = parseInt(req.query.limit) || 1000

            // Extract filter parameters from query string
            const filters = {}
            if (req.query.country) {
                filters.country = req.query.country
            }
            if (req.query.merchantId) {
                filters.merchantId = req.query.merchantId
            }
            if (req.query.category) {
                filters.category = req.query.category
            }

            await Event.getEvents(page, limit, filters).then(result=>{
                return res.status(consts.HTTP_STATUS_OK).json({
                    data: result.events,
                    pagination: result.pagination,
                    timeZone:process.env.TIME_ZONE
                })
            }).catch(err=>{
                error('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get events failed', error: appText.EVENT_GET_FAILED
                })
            })
        }
    })
}

export const getEventFilterOptions = async(req, res, next) => {
    const token = req.headers.authorization
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER === userRoleFromToken) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }

            await Event.getEventFilterOptions().then(result => {
                return res.status(consts.HTTP_STATUS_OK).json({
                    data: result
                })
            }).catch(err => {
                error('error', err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get filter options failed', error: appText.EVENT_GET_FAILED
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

            await Event.getEventById(id).then( async data=>{
                const eventId = data.id
                const validPhotos = data?.eventPhoto?.filter(photo => photo && photo.trim() !== '') || [];
                const photoWithCloudFrontUrls = await Promise.all(validPhotos?.map(async (photo,index) => {
                    const cacheKey = `signedUrl:${eventId}:${index}`;
                    const cached = await commonUtil.getCacheByKey(redisClient, cacheKey);
                    if (cached && cached?.url && cached.expiresAt > Date.now()) {
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
                }))
                /*
                const photosWithCloudFrontUrls = data?.eventPhoto?.map(photo => {
                    // Convert S3 URL to CloudFront URL first
                    const cloudFrontUrl = photo.replace(
                        /https?:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com/,
                        process.env.CLOUDFRONT_URL
                    );
                    const encodedCloudFrontUrl = encodeURI(cloudFrontUrl);
                    const policy = {
                        Statement: [
                          {
                            Resource: encodedCloudFrontUrl,
                            Condition: {
                              DateLessThan: {
                                "AWS:EpochTime": Math.floor(Date.now() / 1000) + (30*24 * 60 * 60) // time in seconds
                              },
                            },
                          },
                        ],
                      };
                    const policyString = JSON.stringify(policy);
                    // Create signed CloudFront URL
                    const signedUrl = getSignedUrl({
                        keyPairId,
                        privateKey,
                        policy:policyString
                    });
                    return signedUrl
                });
                */
                data.eventPhoto = photoWithCloudFrontUrls
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
    const eventTimezone = req.body.eventTimezone
    const convertDateTime = await commonUtil.convertDateTimeWithTimeZone(eventDate, eventTimezone)
    // Build enhanced otherInfo with additional fields
    const otherInfo = {
        ...(req.body.otherInfo || {}),
        categoryName: req.body.categoryName || req.body.category_name,
        subCategoryName: req.body.subCategoryName || req.body.subcategory_name,
        eventExtraInfo: {
            eventType: req.body.eventType || req.body.event_type,
            doorSaleAllowed: req.body.doorSaleAllowed !== undefined ? req.body.doorSaleAllowed : req.body.door_sale_allowed,
            doorSaleExtraAmount: req.body.doorSaleExtraAmount || req.body.door_sale_extra_amount
        }
    };
    //const timeInMinutes =  commonUtil.timeInMinutes(eventTime)

    const city = req.body.city
    const country = req.body.country
    const venueInfo = req.body.venueInfo
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
        otherInfo:otherInfo,
        eventTimezone:eventTimezone,
        city:city,
        country:country,
        venueInfo:venueInfo

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

export const updateEventStatusById = async (req,res,next) =>{
    const token = req.headers.authorization
    const id = req.params.id
    const active = req.body.active
    const featured = req.body.featured

    console.log('updateEventStatusById payload:', { active, featured })

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
            const originalEvent = await Event.getEventById(id)
            if(originalEvent === null || originalEvent === '' || originalEvent === 'undefined'){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ })
            }
            const updatedEvent =  await Event.updateEventById(id,{active:active, featured:featured})
            try {
                // 2. Create outbox message entry
                const correlationId = uuidv4()
                const messageId = uuidv4()

                // Determine routing key and event type based on status
                const routingKey = 'external.event.status.updated'
                const eventType = active === true ? 'EventActivated' : 'EventDeactivated'
                console.log(eventType, active, "========",updatedEvent, updatedEvent?.externalMerchantId, "\n", updatedEvent?.eventTitle)
                const outboxMessageData = {
                    messageId: messageId,
                    exchange: 'event-merchant-exchange',
                    routingKey: routingKey,
                    messageBody: {
                        eventType: eventType,
                        aggregateId: updatedEvent._id.toString(),
                        data: {
                            merchantId: updatedEvent.externalMerchantId,
                            eventId: updatedEvent.externalEventId,
                            before: originalEvent,
                            after: updatedEvent,
                            updatedBy: data.userId,
                            updatedAt: new Date()
                        },
                        metadata: {
                            correlationId: correlationId,
                            causationId: messageId,
                            timestamp: new Date().toISOString(),
                            version: 1
                        }
                    },
                    headers: {
                        'content-type': 'application/json',
                        'message-type': eventType,
                        'correlation-id': correlationId
                    },
                    correlationId: correlationId,
                    eventType: eventType,
                    aggregateId: updatedEvent._id.toString(),
                    status: 'pending',
                    exchangeType: 'topic'
                }

                console.log('=== OUTBOX MESSAGE DATA ===');
                console.log('messageBody.data.merchantId:', outboxMessageData.messageBody.data.merchantId);
                console.log('Full messageBody structure:', JSON.stringify(outboxMessageData.messageBody, null, 2));

                // Validate before serialization
                if (!outboxMessageData.messageBody.data.merchantId) {
                console.error('❌ CRITICAL: merchantId is missing in messageBody.data!');
                console.log('updatedEvent keys:', Object.keys(updatedEvent));
                console.log('updatedEvent.externalMerchantId:', updatedEvent.externalMerchantId);
                throw new Error('merchantId missing in message construction');
                }
                const outboxMessage = await OutboxMessage.createOutboxMessage(outboxMessageData)
                info('Outbox message created for event update:', outboxMessage._id)

                // 3. Publish to RabbitMQ exchange
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
                ).catch(publishError => {
                    error('Error publishing event update:', publishError)
                    throw publishError
                }
                )

                info('Published event update to exchange: %s', outboxMessageData.exchange)

            } catch (publishError) {
                error('Failed to create outbox message or publish merchant update event:', publishError)
                // Continue with response even if publishing fails
            }

           return res.status(consts.HTTP_STATUS_OK).json({ data: updatedEvent })

        }
    }).catch(err=>{
        error('error',err)
        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Sorry, update event failed.', error: err.stack
        })
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
    return await Event.getAllEventsForDashboard()
}
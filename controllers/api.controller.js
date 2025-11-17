import * as jwtToken from '../util/jwtToken.js'
import * as consts from '../const.js'
import * as appText from '../applicationTexts.js'
import * as user from '../controllers/user.controller.js'
import * as contact from '../controllers/contact.controller.js'
import * as photo from '../controllers/photo.controller.js'
import * as notification from '../controllers/notification.controller.js'
import * as event from '../controllers/event.controller.js'
import { param, body } from 'express-validator'
import * as common from '../util/common.js'
import * as photoType from '../model/photoType.js'
import * as setting from '../controllers/setting.controller.js'
import * as ticket from '../controllers/ticket.controller.js'
import * as NotificationType from '../model/notificationType.js'
import {error} from '../model/logger.js'
import * as merchantController from './merchant.controller.js'
import * as report from './report.controller.js'


/** USER STUFF BEGINGS */
export const login = async (req, res, next) => {
    await user.login(req,res,next)
}
export const createAdminUser = async (req, res, next) => {
    await user.createAdminUser(req,res,next)
}
export const getAdminUsers = async (req, res, next) => {
    await user.getAdminUsers(req, res, next)
}
export const createStaffUser = async (req, res, next) => {
    await user.createStaffUser(req,res,next)
}

export const getStaffUsers = async (req, res, next) => {
    await user.getStaffUsers(req,res,next)
}

export const changePassword = async (req, res, next) => {
    await user.changePassword(req,res,next)
}

export const getUserById = async (req, res, next) => {
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await user.getUserById(req,res,next)
    }))
}

export const updateUserById = async(req, res, next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await user.updateUserById(req,res,next)
    }))
}
export const deleteUserById = async (req, res, next) => {
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await user.deleteUserById(req, res, next)
    }))
}

export const getContact = async(req,res, next) => {
    await contact.getContact(req,res,next)
}

export const createContact = async(req, res, next) =>{
    await contact.createContact(req,res,next)
}

export const updateContact = async(req, res, next) =>{
    await contact.updateContact(req, res, next)
}

export const deleteContact = async(req, res,next)=>{
    await contact.deleteContact(req,res,next)
}

export const logout = async (req, res, next) => {

    const token = req.query.token
    if(token !== null){
        await jwtToken.invalidateJWT(token, async (err, data) => {
            res.send(200).json({reply:"ok"})
        })
    }

}


/** USER STUFF ENDS */

/** PHOTO BEGINS */
export const createPhoto = async (req, res, next) => {
    await photo.createPhoto(req, res, next)
}

export const getPhoto = async (req, res, next) => {
    await photo.getAllPhotos(req,res,next)
}

export const getPhotoById = async (req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await photo.getPhotoById(req,res,next)
    }))
}

export const updatePhotoById = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await photo.updatePhotoById(req,res,next)
    }))
}

export const deletePhotoById = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await photo.deletePhotoById(req,res, next)
    }))
}

/** PHOTO ENDS */

/** NOTIFICATION BEGINS */
export const getAllNotification = async(req, res, next) =>{
    await notification.getAllNotification(req,res,next)
}

export const createNotification = async(req, res, next) =>{
    await notification.createNotification(req,res,next)
}

export const getNotificationById = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await notification.getNotificationById(req,res,next)
    }))

}

export const updateNotificationById = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await notification.updateNotificationById(req,res,next)
    }))

}

export const deleteNotificationById = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await notification.deleteNotificationById(req,res,next)
    }))
}
/** NOTIFICATION ENDS */

/** EVENT BEGINS */

export const createEvent = async(req,res, next) =>{
    await common.validate([
        body('eventTitle').notEmpty(),
        body('eventDescription').notEmpty(),
        body('eventDate').notEmpty(),
        body('occupancy').notEmpty().isNumeric(),
        body('eventPromotionPhoto').notEmpty(),
        body('eventLocationAddress').notEmpty(),
        body('eventLocationGeoCode').notEmpty(),
        body('transportLink').notEmpty(),
        body('position').notEmpty(),
        body('active').notEmpty(),

    ], req).then(async data =>{
        if(data.errors.length === 0){
            await event.createEvent(req, res, next)
        } else {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Please check the payload.', error: data.errors })
        }
    })


}

export const getEvents = async(req,res,next) =>{
    await event.getEvents(req,res,next)
}

export const getEventFilterOptions = async(req,res,next) =>{
    await event.getEventFilterOptions(req,res,next)
}

export const getEventById = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await event.getEventById(req,res,next)
    }))
}

export const updateEventById = async(req,res,next) =>{
    await common.validate([
        body('eventTitle').notEmpty(),
        body('eventDescription').notEmpty(),
        body('eventDate').notEmpty(),
        body('occupancy').notEmpty().isNumeric(),
        body('eventPromotionPhoto').notEmpty(),
        body('eventLocationAddress').notEmpty(),
        body('eventLocationGeoCode').notEmpty(),
        body('transportLink').notEmpty(),
        body('position').notEmpty(),
        body('active').notEmpty(),

    ], req).then(async data =>{
        if(data.errors.length === 0){
            await event.updateEventById(req, res, next)
        } else {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Please check the payload.', error: data.errors })
        }
    })
}

export const updateEventStatusById = async(req,res,next) =>{
    await common.validate([
        body('active').isBoolean().withMessage('Active must be true or false')
    ], req).then(async data => {
        if(data.errors.length === 0) {
            const id = req.params.id
            param(id).custom(common.validateParam(id).then(async data=>{
                if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Invalid Id.', error: appText.INVALID_ID
                })
                await event.updateEventStatusById(req,res,next)
            }))
        } else {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                message: 'Please check the payload.', error: data.errors
            })
        }
    })
}

export const uploadPhotosForParticularEvent = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        return await event.uploadPhotosForParticularEvent(req,res,next)
    }))

}
/** EVENT ENDS */

/** dashboard helper */
export const dashboard = async(req, res, next) =>{

    const token = req.headers.authorization
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
            try{
                const eventAll = await event.getAllEventsForDashboard().catch(err=>{
                    error('error',err)
                    throw err
                })
                const photoAll = await photo.getAllPhotoForDashboard().catch(err=>{
                    error('error',err)
                    throw err
                })
                const notificationAll = await notification.getAllNotificationForDashboard().catch(err=>{
                    error('error',err)
                    throw err
                })
                const photoTypes = await photoType.getPhotoTypes().catch(err=>{
                    error('error',err)
                    throw err

                })
                const tickets = await ticket.getAllTickets().catch(err=>{
                    error('error',err)
                    throw err

                })
                const notificationType = await NotificationType.getNotificationTypes()
                const dashboardData = {
                    event:eventAll,
                    photoType:photoTypes,
                    photo:photoAll,
                    notification:notificationAll,
                    ticket:tickets,
                    notificationType:notificationType

                }
                return res.status(consts.HTTP_STATUS_OK).json({ data: dashboardData })
            }catch(err){
                console.log(err)
                if(!res.headersSent){
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, fetching dashboard data failed', error: appText.DASHBOARD_DATA_FAILED
                    })
                }
            }

        }
    })
}

export const getGalleyPhoto = async(req,res,next)=>{

    const photo = await photo.getGalleryPhoto()
    return res.status(consts.HTTP_STATUS_OK).json({ data: photo })

}
/** Setting */
export const createSetting = async(req,res,next) =>{
    await setting.createSetting(req,res,next)
}

export const getSetting = async(req,res,next) =>{
    await setting.getSetting(req,res,next)
}

export const getSettingById = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await setting.getSettingById(req,res,next)
    }))

}

export const updateSettingById = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await setting.updateSettingById(req,res,next)
    }))

}
/** Setting ends */

/** Ticket */
export const createSingleTicket = async(req,res,next) =>{
    await common.validate([
        body('event').notEmpty(),
        body('ticketFor').notEmpty(),
    ], req).then(async data =>{
        if(data.errors.length === 0){
            await ticket.createSingleTicket(req, res, next)
        } else {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Please check the payload.', error: data.errors })
        }
    })
}

export const createMultipleTicket = async(req, res, next) =>{
    return await ticket.createMultipleTicket(req,res,next)
}

export const getAllTicketByEventId = async(req, res, next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await ticket.getAllTicketByEventId(req,res,next)
    }))
}

export const getTicketById = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await ticket.getTicketById(req,res,next)
    }))
}

export const ticketCheckIn = async(req,res,next) =>{
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await ticket.ticketCheckIn(req,res,next)
    }))
}

export const searchTicket = async(req, res, next) => {
    const id = req.params.id
    const {code, phone} = req.query

    // Validate event ID
    param(id).custom(common.validateParam(id).then(async data => {
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Event Id.', error: appText.INVALID_ID
        })

        // Validate search parameters
        if (!code && !phone) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                message: 'Please provide either ticket code or phone number',
                error: appText.TICKET_SEARCH_PARAMS_REQUIRED
            })
        }
        await ticket.searchTicket(req,res,next)

    }))
}

/** Merchant API functions */
export const getAllMerchants = async (req, res, next) => {

    try {
        // Input validation can be added here
        await merchantController.getAllMerchants(req, res, next);
    } catch (error) {
        next(error);
    }
}

export const getMerchantById = async (req, res, next) => {
    const id = req.params.id
    param(id).custom(common.validateParam(id).then(async data => {
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Event Id.', error: appText.INVALID_ID
        })
        await merchantController.getMerchantById(req, res, next);
    }))


}

export const getMerchantByMerchantId = async (req, res, next) => {
    try {
        // Validate merchantId parameter
        if (!req.params.merchantId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                message: 'Merchant ID is required'
            });
        }
        await merchantController.getMerchantByMerchantId(req, res, next);
    } catch (error) {
        next(error);
    }
}

export const updateMerchantById = async (req, res, next) => {
    await common.validate([
        body('status').optional().isIn(['active', 'inactive', 'suspended'])
            .withMessage('Status must be one of: active, inactive, suspended')
    ], req).then(async data => {
        if(data.errors.length === 0) {
            const id = req.params.id
            param(id).custom(common.validateParam(id).then(async data => {
                if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Invalid Event Id.', error: appText.INVALID_ID
                })
                await merchantController.updateMerchantById(req, res, next);
            }))
        } else {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                message: 'Please check the payload.', error: data.errors
            })
        }
    })
}

export const deleteMerchantById = async (req, res, next) => {
    try {
        // Validate ID parameter
        if (!req.params.id) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                message: 'Merchant ID is required'
            });
        }
        await merchantController.deleteMerchantById(req, res, next);
    } catch (error) {
        next(error);
    }
}

export const addOrUpdateOtherInfo = async (req, res, next) => {
    try {
        if (!req.params.id) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                message: 'Merchant ID is required'
            });
        }
        const { otherInfo } = req.body;

        // Validate otherInfo structure
        if (!otherInfo || typeof otherInfo !== 'object' || Array.isArray(otherInfo)) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'VALIDATION_ERROR',
                message: 'otherInfo must be an object',
                details: [{
                    instancePath: '/otherInfo',
                    schemaPath: '#/properties/otherInfo/type',
                    keyword: 'type',
                    params: { type: 'object' },
                    message: 'must be an object'
                }]
            });
        }

        // Validate that all values are numbers
        const invalidEntries = [];
        for (const [key, value] of Object.entries(otherInfo)) {
            if (typeof value !== 'number' || isNaN(value)) {
                invalidEntries.push({
                    instancePath: `/otherInfo/${key}`,
                    schemaPath: '#/properties/otherInfo/additionalProperties/type',
                    keyword: 'type',
                    params: { type: 'number' },
                    message: `must be a number, received: ${typeof value}`
                });
            } else if (value < 0) {
                invalidEntries.push({
                    instancePath: `/otherInfo/${key}`,
                    schemaPath: '#/properties/otherInfo/additionalProperties/minimum',
                    keyword: 'minimum',
                    params: { comparison: '>=', limit: 0 },
                    message: 'must be >= 0'
                });
            }
        }

        if (invalidEntries.length > 0) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                error: 'VALIDATION_ERROR',
                message: 'Validation failed',
                details: invalidEntries
            });
        }

        // If validation passes, proceed to merchant controller
        await merchantController.addOrUpdateOtherInfo(req, res, next);
    } catch (error) {
        next(error);
    }
}

export const getEventFinancialReport = async (req, res, next) => {
    try {
        const eventId = req.params.eventId;
        if (!eventId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Event ID is required',
                error: appText.INVALID_ID
            });
        }

        // Validate MongoDB ObjectId format
        const isValidObjectId = await common.validateParam(eventId);
        if (!isValidObjectId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Invalid Event ID format',
                error: appText.INVALID_ID
            });
        }

        await report.getEventFinancialReport(req, res, next);
    } catch (error) {
        next(error);
    }
}

export const requestExternalTicketSalesData = async (req, res, next) => {
    try {
        const eventId = req.params.eventId;
        if (!eventId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Event ID is required',
                error: appText.INVALID_ID
            });
        }

        // Validate MongoDB ObjectId format
        const isValidObjectId = await common.validateParam(eventId);
        if (!isValidObjectId) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                success: false,
                message: 'Invalid Event ID format',
                error: appText.INVALID_ID
            });
        }

        await report.requestExternalTicketSalesData(req, res, next);
    } catch (error) {
        next(error);
    }
}
/** Ticket Ends  */


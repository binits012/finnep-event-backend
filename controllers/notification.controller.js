'use strict'
const jwtToken = require('../util/jwtToken')
const logger = require('../model/logger')
const appText = require('../applicationTexts.js') 
const consts = require('../const') 
const Notification = require('../model/notification.js')
const NotificationType = require('../model/notificationType.js')

const createNotification = async (req, res, next) => {
    const token = req.headers.authorization
    const notification = req.body.notification
    const startDate = req.body.startDate
    const endDate = req.body.endDate
    let lang = req.body.lang
    const notificationType = req.body.notificationType
    const publish = req.body.publish
    if(lang === 'undefined' || lang === ""){
        lang = 'en'
    }  
    const notificationObj = {
        notification: notification,
        startDate: new Date(startDate.replace('T',' ')),
        endDate: new Date(endDate.replace('T',' ')),
        notificationType: notificationType,
        lang: lang,
        publish: publish === 'true' ? true :false
    } 
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_STAFF === userRoleFromToken || consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            const getNotification = await Notification.getNotificationByIdAndDate(notification, startDate, endDate) 
            if (getNotification === null) {
                await Notification.createNotification(notificationObj.notificationType, notificationObj.notification, notificationObj.startDate, 
                    notificationObj.endDate, notificationObj.publish, notificationObj.lang)
                    .then(data => { 
                        return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
                    })
                    .catch(err => {
                        logger.log('error', err.stack) 
                        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                            message: 'Sorry, something went wrong', error: err
                        })
                    })

            } else { 
                return res.status(consts.HTTP_STATUS_NOT_IMPLEMENTED).json({
                    message: 'Sorry, something went wrong', error: "What are you trying to do."
                })
            }
        }
    })
}

const getAllNotification = async (req, res, next) => {
    const token = req.headers.authorization
    await jwtToken.verifyJWT(token, async (err, data) => { 
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_STAFF === userRoleFromToken || consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            await Notification.getAllNotification().then(data => {
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err => {
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    message: 'Sorry, something went wrong', error: err
                })
            })
        }
    })
    
}
const getNotificationById = async (req, res, next) => {
    const notificationId = req.params.id
    const token = req.headers.authorization
    await jwtToken.verifyJWT(token, async (err, data) => { 
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_STAFF === userRoleFromToken || consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            await Notification.getNotificationById(notificationId).then(data => {
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err => {
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    message: 'Sorry, something went wrong', error: err
                })
            })
        }
    })
    
}

const updateNotificationById = async (req, res, next) => {
    const token = req.headers.authorization
    const notification = req.body.notification
    const startDate = req.body.startDate
    const endDate = req.body.endDate
    const publish = req.body.publish
    const notificationId = req.params.id
    const notificationType = req.body.notificationType
    let lang = req.body.lang
    if(lang === 'undefined' || lang === ""){
        lang = 'en'
    }
    
    const notificationObj = {
        notification: notification,
        startDate: new Date(startDate.replace('T',' ')),
        endDate: new Date(endDate.replace('T',' ')),
        publish: publish , 
        notificationType: notificationType,
        lang: lang
    }

    await jwtToken.verifyJWT(token, async (err, data) => { 
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_STAFF === userRoleFromToken || consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            const getNotificationType = await NotificationType.getNotificationTypeById(notificationType)
            if(getNotificationType.length == 0){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, no record exists', error: appText.RESOURCE_NOT_FOUND
                })
            }
            const getNotification = await Notification.getNotificationById(notificationId)

            if (getNotification !== null) {
                await Notification.updateNotificationById(notificationId,notificationObj )
                    .then(data => { 
                        return res.status(consts.HTTP_STATUS_OK).json({ data: data })
                    })
                    .catch(err => {
                        logger.log('error',err) 
                        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                            message: 'Sorry, something went wrong', error: err
                        })
                    })

            } else { 
                return res.status(consts.HTTP_STATUS_NOT_IMPLEMENTED).json({
                    message: 'Sorry, something went wrong', error: "The item is already available. What are you trying to do."
                })
            }
        }
    })
}

const deleteNotificationById = async (req, res, next) => {
    const notificationId = req.params.id
    const token = req.headers.authorization
    if (token === "" || token === null || token === undefined
        || notificationId === "" || notificationId === null || notificationId === undefined) {
        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Bad Request', error: "Bad Request- either token or id is missing."
        })
    }

    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_STAFF === userRoleFromToken || consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            const getNotification = await Notification.getNotificationById(notificationId)

            if (getNotification !== null) {
                await Notification.deleteNotificationById(notificationId)
                    .then(data => { 
                        return res.status(consts.HTTP_STATUS_OK).send()
                    })
                    .catch(err => {
                        logger.log('error',err) 
                        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                            message: 'Sorry, something went wrong', error: err
                        })
                    })

            } else { 
                return res.status(consts.HTTP_STATUS_NOT_IMPLEMENTED).json({
                    message: 'Sorry, something went wrong', error: "The item is already gone. What are you trying to do."
                })
            }
        }
    })

}
 
const getAllNotificationForDashboard = async() =>{
    return await Notification.getAllNotification()
}
module.exports = {
    createNotification,
    getAllNotification,
    getNotificationById,
    updateNotificationById,
    deleteNotificationById,
    getAllNotificationForDashboard
}

'use strict'
const jwtToken = require('../util/jwtToken')

const user = require('../controllers/user.controller')
const contact = require('../controllers/contact.controller')
const photo = require('../controllers/photo.controller')
const notification = require('../controllers/notification.controller')
const event = require('../controllers/event.controller')
const { param, body } = require('express-validator')
const common = require('../util/common')
const consts = require('../const')
const appText = require('../applicationTexts.js')

/** USER STUFF BEGINGS */
const login = async (req, res, next) => {
    await user.login(req,res,next)
}
const createAdminUser = async (req, res, next) => {
    await user.createAdminUser(req,res,next)
}
const getAdminUsers = async (req, res, next) => {
    await user.getAdminUsers(req, res, next)
}
const createStaffUser = async (req, res, next) => {
    await user.createStaffUser(req,res,next)
}

const getStaffUsers = async (req, res, next) => {
    await user.getStaffUsers(req,res,next)
}

const changePassword = async (req, res, next) => {
    await user.changePassword(req,res,next)
}

const getUserById = async (req, res, next) => {
    const id = req.params.id 
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await user.getUserById(req,res,next)
    }))   
}

const updateUserById = async(req, res, next) =>{
    const id = req.params.id 
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await user.updateUserById(req,res,next)
    })) 
}
const deleteUserById = async (req, res, next) => {
    const id = req.params.id 
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await user.deleteUserById(req, res, next)
    }))
}

const getContact = async(req,res, next) => {
    await contact.getContact(req,res,next)
}

const createContact = async(req, res, next) =>{
    await contact.createContact(req,res,next)
}

const updateContact = async(req, res, next) =>{
    await contact.updateContact(req, res, next) 
}

const deleteContact = async(req, res,next)=>{
    await contact.deleteContact(req,res,next)
}

const logout = async (req, res, next) => {
	
    const token = req.query.token
    if(token !== null){
        await jwtToken.invalidateJWT(token, async (err, data) => {
            res.send(200).json({reply:"ok"})
        })
    }
	
}


/** USER STUFF ENDS */

/** PHOTO BEGINS */
const createPhoto = async (req, res, next) => {
    await photo.createPhoto(req, res, next)
}

const getPhoto = async (req, res, next) => {
    await photo.getAllPhotos(req,res,next)
}

const getPhotoById = async (req,res,next) =>{
    const id = req.params.id 
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await photo.getPhotoById(req,res,next)
    })) 
}

const updatePhotoById = async(req,res,next) =>{
    const id = req.params.id 
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await photo.updatePhotoById(req,res,next)
    }))  
}

const deletePhotoById = async(req,res,next) =>{
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
const getAllNotification = async(req, res, next) =>{
    await notification.getAllNotification(req,res,next)
}

const createNotification = async(req, res, next) =>{
    await notification.createNotification(req,res,next)
}

const getNotificationById = async(req,res,next) =>{
    const id = req.params.id 
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await notification.getNotificationById(req,res,next)
    }))
    
}

const updateNotificationById = async(req,res,next) =>{
    const id = req.params.id 
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await notification.updateNotificationById(req,res,next)
    }))
    
}

const deleteNotificationById = async(req,res,next) =>{
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

const createEvent = async(req,res, next) =>{
    
    await common.validate([
        body('eventTitle').notEmpty(),
        body('eventDescription').notEmpty(),
        body('eventDate').notEmpty(),
        body('eventTime').notEmpty(),
        body('eventPrice').notEmpty(),
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

const getEvents = async(req,res,next) =>{
    await event.getEvents(req,res,next)
}

const getEventById = async(req,res,next) =>{
    const id = req.params.id 
    param(id).custom(common.validateParam(id).then(async data=>{
        if(!data) return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid Id.', error: appText.INVALID_ID
        })
        await event.getEventById(req,res,next)
    }))
}

const updateEventById = async(req,res,next) =>{
    await common.validate([
        body('eventTitle').notEmpty(),
        body('eventDescription').notEmpty(),
        body('eventDate').notEmpty(),
        body('eventTime').notEmpty(),
        body('eventPrice').notEmpty(),
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
 
/** EVENT ENDS */
module.exports = {
    login,
    createAdminUser,
    getAdminUsers,
    createStaffUser, 
    getStaffUsers,
    changePassword,
    getUserById,
    updateUserById,
    deleteUserById,
    getContact,
    createContact,
    updateContact,
    deleteContact,
    logout,

    //photo
    createPhoto,
    getPhoto,
    getPhotoById,
    updatePhotoById,
    deletePhotoById,
    
    //notification
    getAllNotification,
    createNotification,
    getNotificationById,
    updateNotificationById,
    deleteNotificationById,

    //event
    createEvent,
    getEvents,
    getEventById,
    updateEventById
}

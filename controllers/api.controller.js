'use strict'
const jwtToken = require('../util/jwtToken')

const user = require('../controllers/user.controller')
const contact = require('../controllers/contact.controller')
const photo = require('../controllers/photo.controller')
const notification = require('../controllers/notification.controller')

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
    await user.getUserById(req,res,next)
}

const updateUserById = async(req, res, next) =>{
    await user.updateUserById(req,res,next)
}
const deleteUserById = async (req, res, next) => {
    await user.deleteUserById(req, res, next)
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
    await photo.getPhotoById(req,res,next)
}

const updatePhotoById = async(req,res,next) =>{
    await photo.updatePhotoById(req,res,next)
}

const deletePhotoById = async(req,res,next) =>{
    await photo.deletePhotoById(req,res, next)
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
    await notification.getNotificationById(req,res,next)
}

const updateNotificationById = async(req,res,next) =>{
    await notification.updateNotificationById(req,res,next)
}

const deleteNotificationById = async(req,res,next) =>{
    await notification.deleteNotificationById(req,res,next)
}

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
    deleteNotificationById
}

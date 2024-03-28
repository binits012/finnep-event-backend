"use strict"
const express = require('express')
const router = express.Router()
const api = require('../controllers/api.controller') 

router.route('/auth/user/login').post(api.login)
router.route('/auth/user/changePassword').post(api.changePassword)
router.route('/user/admin')
    .post(api.createAdminUser)
    .get(api.getAdminUsers)
router.route('/user/staff')
    .post(api.createStaffUser)
    .get(api.getStaffUsers)

router.route('/user/:id')
    .get(api.getUserById)
    .delete(api.deleteUserById)
    .patch(api.updateUserById) 

router.route('/user/:id/contact')
    .get(api.getContact)
    .post(api.createContact)
    .patch(api.updateContact)
    .delete(api.deleteContact)

router.route('/photo')
    .post(api.createPhoto)
    .get(api.getPhoto)
    .patch(api.updatePhotoById)
    .delete(api.deletePhotoById)

 
router.route('/notification')
    .get(api.getAllNotification)
    .post(api.createNotification)

router.route('/notification/:id')
    .get(api.getNotificationById)
    .patch(api.updateNotificationById)
    .delete(api.deleteNotificationById)


router.route('/event')
    .post(api.createEvent)
    .get(api.getEvents)

router.route('/event/:id')
    .get(api.getEventById)
    .put(api.updateEventById) 

router.route('/dashboard')
    .get(api.dashboard)
router.route('/logout')
    .get(api.logout)
module.exports = router
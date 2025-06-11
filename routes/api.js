/*
"use strict"
const express = require('express')
const router = express.Router() 
const api = require('../controllers/api.controller') 
*/
import * as express from 'express'
const router = express.Router() 
import * as api  from '../controllers/api.controller.js'

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
    .get(api.getPhoto)
    .post(api.createPhoto)
    .patch(api.updatePhotoById)
router.route('/photo/:id')
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
    .get( api.getEventById)
    .put(api.updateEventById) 
    
router.route('/event/:id/eventPhoto')
    .post(api.uploadPhotosForParticularEvent)

router.route('/setting')
    .post(api.createSetting)
    .get(api.getSetting)

router.route('/setting/:id')
    .get(api.getSettingById)
    .post(api.updateSettingById)
    
router.route('/singleTicket')
    .post(api.createSingleTicket)
router.route('/multipleTicket')
    .post(api.createMultipleTicket)
router.route('/event/:id/ticket')
    .get(api.getAllTicketByEventId)

router.route('/event/:id/searchTicket')
    .get(api.searchTicket)

router.route('/ticket/:id')
    .get(api.getTicketById)

router.route('/ticket/:id/checkIn')
    .put(api.ticketCheckIn)

router.route('/dashboard')
    .get(api.dashboard)
router.route('/logout')
    .get(api.logout)

export default router
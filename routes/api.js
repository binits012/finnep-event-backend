/*
"use strict"
const express = require('express')
const router = express.Router()
const api = require('../controllers/api.controller')
*/
import * as express from 'express'
const router = express.Router()
import * as api  from '../controllers/api.controller.js'
import * as report from '../controllers/report.controller.js'
import { authenticate, requireAdmin } from '../middleware/auth.middleware.js'
import {
    createPaytrailSubMerchant,
    togglePaytrailForMerchant,
    toggleShopInShopMode
} from '../controllers/paytrail.admin.controller.js'

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

// Queue service configuration endpoints (no auth needed - internal service communication)
router.route('/queue/config/email')
    .get(api.getEmailConfig)

router.route('/queue/config/metrics')
    .get(api.getSystemMetrics)


router.route('/event')
    .post(api.createEvent)
    .get(api.getEvents)

router.route('/event/filters/options')
    .get(api.getEventFilterOptions)

router.route('/event/:id')
    .get( api.getEventById)
    .put(api.updateEventById)
    .patch(api.updateEventStatusById)

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

router.route('/event/:eventId/financial-report')
    .get(report.getEventFinancialReport)

router.route('/event/:eventId/request-external-ticket-sales')
    .post(report.requestExternalTicketSalesData)

router.route('/ticket/:id')
    .get(api.getTicketById)

router.route('/ticket/:id/checkIn')
    .put(api.ticketCheckIn)

router.route('/dashboard')
    .get(api.dashboard)
router.route('/logout')
    .get(api.logout)

/** merchant calls */
router.route('/merchant')
    .get(api.getAllMerchants)

router.route('/merchant/:id')
    .get(api.getMerchantById)
    .patch(api.updateMerchantById)
router.route('/merchant/:id/otherInfo')
    .patch(api.addOrUpdateOtherInfo)

// Paytrail admin routes (admin only)
router.route('/admin/paytrail/create-submerchant')
    .post(authenticate, requireAdmin, createPaytrailSubMerchant)
router.route('/admin/paytrail/toggle')
    .post(authenticate, requireAdmin, togglePaytrailForMerchant)
router.route('/admin/paytrail/commission/:merchantId')
    .put(authenticate, requireAdmin, togglePaytrailForMerchant)
router.route('/admin/paytrail/shop-in-shop/toggle')
    .post(authenticate, requireAdmin, toggleShopInShopMode)

// Venue management for merchants (authenticated, no admin required)
router.route('/merchant/:merchantId/venue')
    .get(authenticate, api.getVenuesByMerchant)

// Venue management (admin only)
router.route('/venue')
    .post(authenticate, requireAdmin, api.createVenue)
    .get(authenticate, requireAdmin, api.getVenues)
router.route('/venue/:id')
    .get(authenticate, requireAdmin, api.getVenueById)
    .put(authenticate, requireAdmin, api.updateVenueById)
    .delete(authenticate, requireAdmin, api.deleteVenueById)
router.route('/venue/:id/sections')
    .put(authenticate, requireAdmin, api.updateVenueSections)

// Manifest management (admin only)
router.route('/manifest')
    .post(authenticate, requireAdmin, api.createManifest)
    .get(authenticate, requireAdmin, api.getManifests)
router.post('/manifest/generate', authenticate, requireAdmin, api.generateManifest)
router.route('/manifest/venue/:venueId')
    .get(authenticate, requireAdmin, api.getManifestsByVenue)
router.route('/manifest/:id')
    .get(authenticate, requireAdmin, api.getManifestById)
    .put(authenticate, requireAdmin, api.updateManifest)
    .delete(authenticate, requireAdmin, api.deleteManifest)
router.route('/manifest/:id/place')
    .post(authenticate, requireAdmin, api.addOrUpdatePlace)
router.route('/manifest/:id/place/:placeId')
    .delete(authenticate, requireAdmin, api.deletePlace)
router.post('/manifest/:manifestId/sync', authenticate, requireAdmin, api.syncManifestToEventMerchant)

// Seat management endpoints (authenticated, no admin required for frontend access)
router.route('/event/:eventId/seats')
	.get(authenticate, api.getEventSeats)
	.post(authenticate, api.reserveSeats)
router.post('/event/:eventId/seats/confirm', authenticate, api.confirmSeats)
router.delete('/event/:eventId/seats/release', authenticate, api.releaseSeats)

export default router
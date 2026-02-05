/*
"use strict"
const express = require('express')
const router = express.Router()
const front = require('../controllers/front.controller')
*/
import * as express from 'express'
const router = express.Router()
import * as front  from '../controllers/front.controller.js'
import * as guest from '../controllers/guest.controller.js'
import { handlePaytrailWebhook } from '../controllers/paytrail.webhook.js'
router.route('/')
    .get(front.getDataForFront)
router.route('/events')
    .get(front.listEvent)
router.route('/event/:id')
    .get(front.getEventById)
router.route('/create-checkout-session')
    .post(front.createCheckoutSession)
router.route('/create-payment-intent')
    .post(front.createPaymentIntent)
router.route('/create-paytrail-payment')
    .post(front.createPaytrailPayment)
router.route('/verify-paytrail-payment')
    .post(front.verifyPaytrailPayment)
router.route('/handle-paytrail-payment-failure')
    .post(front.handlePaytrailPaymentFailure)
router.route('/payment-success')
    .post(front.handlePaymentSuccess)

router.route('/ticket')
    .post(front.completeOrderTicket)
router.route('/ticket/cancel')
    .post(front.cancelOrderTicket)

router.route('/sendFeedback')
    .post(front.sendFeedback)

router.route('/sendCareerApplication')
    .post(front.sendCareerApplication)

router.route('/free-event-register')
    .post(front.handleFreeEventRegistration)

/** public seat selection endpoints */
router.route('/event/:eventId/seats')
    .get(front.getEventSeatsPublic)
router.route('/event/:eventId/seats/reserve')
    .post(front.reserveSeatsPublic)
router.route('/event/:eventId/seats/release')
    .post(front.releaseSeatsPublic)
router.route('/event/:eventId/seats/send-otp')
    .post(front.sendSeatOTP)
router.route('/event/:eventId/seats/verify-otp')
    .post(front.verifySeatOTP)

/** guest ticket access */
router.route('/guest/check-email')
    .post(guest.checkEmail)

router.route('/guest/send-code')
    .post(guest.sendVerificationCode)

router.route('/guest/verify-code')
    .post(guest.verifyCode)

router.route('/guest/tickets')
    .get(guest.getTickets)

router.route('/guest/ticket/:id')
    .get(guest.getTicketById)

// Paytrail webhook routes
router.route('/webhooks/paytrail/success')
    .post(handlePaytrailWebhook)
router.route('/webhooks/paytrail/cancel')
    .post(handlePaytrailWebhook)

export default router
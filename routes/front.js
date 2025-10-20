/*
"use strict"
const express = require('express')
const router = express.Router()
const front = require('../controllers/front.controller') 
*/
import * as express from 'express'
const router = express.Router() 
import * as front  from '../controllers/front.controller.js'
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

export default router
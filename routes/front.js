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

router.route('/create-checkout-session')
    .post(front.createCheckoutSession)

router.route('/ticket')
    .post(front.completeOrderTicket)
router.route('/ticket/cancel')
    .post(front.cancelOrderTicket)
 
export default router
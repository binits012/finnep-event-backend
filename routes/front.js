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

export default router
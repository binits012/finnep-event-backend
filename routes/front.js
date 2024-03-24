"use strict"
const express = require('express')
const router = express.Router()
const front = require('../controllers/front.controller') 

router.route('/')
    .get(front.getDataForFront)
module.exports = router
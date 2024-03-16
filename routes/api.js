"use strict"
const express = require('express')
const router = express.Router()
const api = require('../controllers/api.controller')
const user = require('../controllers/user.controller')
const contact = require('../controllers/contact.controller')

router.route('/auth/user/login').post(api.login)
router.route('/auth/user/changePassword').post(api.changePassword)
router.route('/user/admin')
    .post(api.createAdminUser)
    .get(api.getAdminUsers)
router.route('/user/staff')
    .post(api.createStaffUser)
    .get(api.getStaffUsers)

router.route('/user/:id')
    .get(user.getUserById)
    .delete(user.deleteUserById)
    .patch(user.updateUserById) 

router.route('/user/:id/contact')
    .get(contact.getContact)
    .post(contact.createContact)
    .patch(contact.updateContact)
    .delete(contact.deleteContact)

    module.exports = router
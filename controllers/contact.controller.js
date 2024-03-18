'use strict'
const jwtToken = require('../util/jwtToken')
const logger = require('../model/logger')
const User = require('../model/users')
const Contact = require('../model/contact')
const appText = require('../applicationTexts.js')
const commonUtil = require('../util/common')
require('dotenv').config()
const consts = require('../const')

const createContact = async (req, res, next) => {
    const username = req.body.username
    const token = req.headers.authorization
    const streetName = req.body.streetName
    const phone = req.body.phoneNumber
    const email = req.body.emailAddress
    const userId = req.params.id 
    const manipulatedNumber = await commonUtil.manipulatePhoneNumber(phone) 
    if(manipulatedNumber === null){
        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'bad phone number.', error: "you provided bad phone number "});
        logger.log('error',"reservation create failed."+token)
        return
    }
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
            return
        } else {
            //check user
            const user = await User.getUserById(userId)
            if(user === null){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json(
                {
                    message: 'Given user not found.', error: appText.RESOURCE_NOT_FOUND
                })
            }
            const userFromToken = data.username
            const userRoleFromToken = data.role
            const getUserFromToken = await User.getUserByName(userFromToken)
            const getUserFromPayload = await User.getUserByName(username) 
            if (getUserFromPayload.role.roleType === consts.ROLE_SUPER_ADMIN || consts.ROLE_CUSTOMER === userRoleFromToken) {
                res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
                return
            }
            if (getUserFromToken.role.roleType === consts.ROLE_STAFF &&
                (getUserFromPayload.role.roleType === consts.ROLE_SUPER_ADMIN
                    || getUserFromPayload.role.roleType === consts.ROLE_ADMIN)) {
                res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
                return
            }
            //create user contact
            if (consts.ROLE_STAFF === userRoleFromToken && userFromToken !== getUserFromPayload.name) {
                res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, not the same user', error: appText.INSUFFICENT_ROLE
                })
                return
            }
            const userContact = await Contact.getContactById(getUserFromPayload.id)
            if (userContact === null) {
                await Contact.createContact(streetName, manipulatedNumber, email, getUserFromPayload).then(data => {
                    delete data.crypto[0]
                    delete data.crypto[1]
                    data.user.pwd = ""
                    return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
                }).catch(err => {
                    logger.log('error',err)
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, contact creation failed', error: appText.CONTACT_CREATE_FAILED
                    })
                })
            } else {
                // there seems to have previous record, just update them
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, previous record exists', error: appText.CONTACT_CREATE_FAILED
                })
            }
        }
    })

}

const getContact = async (req, res, next) => {
    const token = req.headers.authorization
    const userId = req.params.id
    if (userId === null || userId === "" || userId === undefined
        || token === null || token === "" || token === undefined) {
        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Sorry, get User contact failed', error: appText.USER_NOT_FOUND
        })
    }
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userFromToken = data.username
            const userRoleFromToken = data.role
            const getUserFromToken = await User.getUserByName(userFromToken).catch(err =>{
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'not found', error: err
                })
            })
            const getUserByGivenId = await User.getUserById(userId)
             
            if(getUserByGivenId === null || getUserByGivenId.error ){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Resource not found', error: appText.RESOURCE_NOT_FOUND
                })
            }
            if (getUserByGivenId.role.roleType === consts.ROLE_SUPER_ADMIN) {
                UserActivity.createUserActivity(token, Action.READ, "get user contact failed.")
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            if (getUserFromToken.role.roleType === consts.ROLE_STAFF &&
                (getUserByGivenId.role.roleType === consts.ROLE_SUPER_ADMIN
                    || getUserByGivenId.role.roleType === consts.ROLE_ADMIN)) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            //create user contact
            if (consts.ROLE_STAFF === userRoleFromToken && userFromToken !== getUserByGivenId.name) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, not the same user', error: appText.INSUFFICENT_ROLE
                })
            }

            await Contact.getContactById(getUserByGivenId.id).then(data => {
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err => {
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, listing user contact failed', error: appText.CONTACT_READ_FAILED
                })
            })
        }
    })
}

const updateContact = async (req, res, next) => {
    const username = req.body.username
    const token = req.headers.authorization
    const streetName = req.body.streetName
    const phone = req.body.phoneNumber
    const email = req.body.emailAddress
    const userId = req.params.id
    
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
           return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userFromToken = data.username
            const userRoleFromToken = data.role
            const getUserFromToken = await User.getUserByName(userFromToken)
            const getUserFromPayload = await User.getUserByName(username)
            if(getUserFromPayload === null){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, You do not have rights', error: appText.RESOURCE_NOT_FOUND
                })
            }
            if (getUserFromPayload.role.roleType === consts.ROLE_SUPER_ADMIN) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            if (getUserFromToken.role.roleType === consts.ROLE_STAFF &&
                (getUserFromPayload.role.roleType === consts.ROLE_SUPER_ADMIN
                    || getUserFromPayload.role.roleType === consts.ROLE_ADMIN)) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            if (consts.ROLE_STAFF === userRoleFromToken && userFromToken !== getUserFromPayload.name) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, not the same user', error: appText.INSUFFICENT_ROLE
                })
            }
            let userContact = await Contact.getContactById(userId)
            if (userContact === null) {
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, no record exists', error: appText.CONTACT_UPDATE_FAILED
                })

            } else {
                await Contact.updateContactById(userContact._id, streetName, userContact.contact[0]._id, email,
                    userContact.contact[1]._id, phone)
                if (updateContact !== null) {
                    await Contact.getContactById(getUserFromPayload.id).then(data => {
                        return res.status(consts.HTTP_STATUS_OK).json({ data: data })
                    }).catch(err => {
                        logger.log('error',err)
                         return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                            message: 'Sorry, listing user contact failed', error:err
                        })
                    })
                } else {
                     return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, something went haywire', error: appText.CONTACT_UPDATE_FAILED
                    })
                }

            }
        }
    })
}

const deleteContact = async (req, res, next) => {
    const token = req.headers.authorization
    const userId = req.params.id
    if (userId === null || userId === "" || userId === undefined
        || token === null || token === "" || token === undefined) {
        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Sorry, get User contact failed', error: appText.USER_NOT_FOUND
        })
    }
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
             return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userFromToken = data.username
            const userRoleFromToken = data.role
            const getUserFromToken = await User.getUserByName(userFromToken)
            const getUserByGivenId = await User.getUserById(userId)
            if(getUserByGivenId === null){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, You do not have rights', error: appText.RESOURCE_NOT_FOUND
                })
            }
            if (getUserByGivenId.role.roleType === consts.ROLE_SUPER_ADMIN) {
                 return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            if (getUserFromToken.role.roleType === consts.ROLE_STAFF &&
                (getUserByGivenId.role.roleType === consts.ROLE_SUPER_ADMIN
                    || getUserByGivenId.role.roleType === consts.ROLE_ADMIN)) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            //create user contact
            if (consts.ROLE_STAFF === userRoleFromToken && userFromToken !== getUserByGivenId.name) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, not the same user', error: appText.INSUFFICENT_ROLE
                })
            }
            let userContact = await Contact.getContactById(getUserByGivenId.id)
            if (userContact === null) {
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, deleting user contact failed', error: appText.CONTACT_DELETE_FAILED
                })
            } else {
                await Contact.deleteContactById(userContact._id, userContact.contact[0]._id,
                    userContact.contact[1]._id).then(data => {
                        return res.status(consts.HTTP_STATUS_NO_CONTENT).send()
                    }).catch(err => {
                        logger.log('error',err)
                        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                            message: 'Sorry, deleting user contact failed', error: appText.CONTACT_DELETE_FAILED
                        })
                    })
            }

        }
    })
}
module.exports = {
    createContact,
    getContact,
    updateContact,
    deleteContact
}

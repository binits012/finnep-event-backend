import * as jwtToken from '../util/jwtToken.js'
import {error} from '../model/logger.js'
import * as User from '../model/users.js'
import * as appText from '../applicationTexts.js'
import dotenv from 'dotenv'
dotenv.config() 
import * as consts from '../const.js'
import * as Role from '../model/role.js'
import * as common from '../util/common.js'
import * as Contact from '../model/contact.js'

export const login = async (req, res, next) => {
    const username = req.body.username
    const password = req.body.password
    await User.loginCheck(username, password).then(data => {
        if (data) {
            const userData = {
                username: data.name,
                role: data.role.roleType,
                id:data.id
            }
            jwtToken.generateJWT(userData, async(err, data) =>{ 
                if(data){ 
                    res.status(consts.HTTP_STATUS_OK).json({ token: data }) 
                }else{
                    error('error',err.stack)
                    res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to create token. Check inputs.', error: err.stack });
                }
            }) 
        } else { 
            res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to create token. Check inputs.', error: appText.FAILED_TO_CREATE_TOKEN });

        }

    }).catch(err => { 
        error('error',err)
        next(err)
        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to create token. Check inputs.', error: err.stack });
    })
}

export const createAdminUser = async (req, res, next) => {
    const username = req.body.username
    const password = req.body.password
    const token = req.headers.authorization 
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userRoleFromToken = data.role

            if (consts.ROLE_SUPER_ADMIN === userRoleFromToken ||
                consts.ROLE_ADMIN === userRoleFromToken) {
                //get the admin role
                const adminRole = await Role.getRoleByRoleType(consts.ROLE_ADMIN)
                await User.createUser(username, password,
                    adminRole._id, true, true).then(data => {
                        const createdUser = {
                            name: data.name,
                            active: data.active
                        } 
                        return res.status(consts.HTTP_STATUS_CREATED).json({ data: createdUser })
                    }
                    )
                    .catch(e => {
                        error('error',e.stack) 
                        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to create new user. Check inputs.', error: e.message });
                    })
            } else { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }

        }
    })

}

export const createStaffUser = async (req, res, next) => {
    const username = req.body.username
    const password = req.body.password
    const token = req.headers.authorization
    //verify token
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userRoleFromToken = data.role
            if (consts.ROLE_SUPER_ADMIN === userRoleFromToken ||
                consts.ROLE_ADMIN === userRoleFromToken) {
                //get the staff role
                const staffRole = await Role.getRoleByRoleType(consts.ROLE_STAFF)
                await User.createUser(username, password,
                    staffRole._id, true, true).then(data => {
                        const createdUser = {
                            name: data.name,
                            active: data.active
                        }
                        res.status(consts.HTTP_STATUS_CREATED).json({ data: createdUser })
                    })
                    .catch(e => {
                        error('error',e.stack)
                        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to create new user. Check inputs.', error: e.message });
                    })
            } else { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }

        }
    })
}

export const getAdminUsers = async (req, res, next) => {
    const token = req.headers.authorization
    if (token === "" || token === undefined) {
        return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
            message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
        })
    } else {
        await jwtToken.verifyJWT(token, async (err, data) => {
            if (err || data === null) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
                })
            } else { 
                const userRoleFromToken = data.role
                if (consts.ROLE_SUPER_ADMIN === userRoleFromToken ||
                    consts.ROLE_ADMIN === userRoleFromToken) {
                    //get list of admin Users 
                    await User.getUsersByRole(consts.ROLE_ADMIN).then(data => {
                        res.status(consts.HTTP_STATUS_OK).json({ data: data })
                    }).catch(e => {
                        error('error',e.stack)
                        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to get admin users List.', error: e.message });
                    })
                } else { 
                    return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                        message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                    })
                }
            }
        })
    }
}

export const getStaffUsers = async (req, res, next) => {
    const token = req.headers.authorization
    if (token === "" || token === undefined) {
        return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
            message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
        })
    } else {
        await jwtToken.verifyJWT(token, async (err, data) => {
            if (err || data === null) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
                })
            } else {
                const userRoleFromToken = data.role
                if (consts.ROLE_SUPER_ADMIN === userRoleFromToken ||
                    consts.ROLE_ADMIN === userRoleFromToken) {
                    //get list of admin Users 
                    await User.getUsersByRole(consts.ROLE_STAFF).then(data => { 
                        res.status(consts.HTTP_STATUS_OK).json({ data: data })
                    }).catch(e => {
                        error('error',e.stack)
                        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to get staff users List.', error: e.message });
                    })
                } else { 
                    return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                        message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                    })
                }

            }
        })
    }
}

export const changePassword = async (req, res, next) => {

    const username = req.body.username
    const oldPassword = req.body.oldPassword
    const newPassword = req.body.newPassword
    const token = req.headers.authorization

    //check token
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userFromToken = data.username 
            const getUserFromToken = await User.getUserByName(userFromToken)
            const getUserFromPayload = await User.getUserByName(username)
            if(getUserFromPayload === null){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'User not found', error: appText.RESOURCE_NOT_FOUND
                })
            }
            let pwdCheck = await getUserFromPayload.comparePassword(oldPassword)
            if (getUserFromPayload.pwd === oldPassword) {
                pwdCheck = true
            }
            if (!pwdCheck) { 
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Your old password does not match', error: appText.CREDENTIALS_REQUIRED
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
            if(getUserFromToken.role.roleType === consts.ROLE_STAFF && getUserFromToken.name !== username ){
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            //change the password
            const filter = { 'name': username }
            const update = { 'pwd': newPassword }

            await User.updateUserPassword(filter, update).then(data => { 
                const createdUser = {
                    name: data.name,
                    active: data.active
                } 
                return res.status(consts.HTTP_STATUS_OK).json({ data: createdUser })
            })
        }
    })
}

export const getUserById = async (req, res, next) => {
    const userId = req.params.id
    const token = req.headers.authorization
    if (userId === null || userId === "" || userId === undefined
        || token === null || token === "" || token === undefined) {
        res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ message: 'given user not found. Check inputs.' });
        return
    }

    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userFromToken = data.username
            const getUserFromToken = await User.getUserByName(userFromToken)
            const getUserFromId = await User.getUserById(userId)
            if(getUserFromId === null){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Given user not found.', error: appText.RESOURCE_NOT_FOUND
                })
            }
            if (consts.ROLE_SUPER_ADMIN === getUserFromId.role.roleType ) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Stop, you are not allowed to do so', error: appText.STOP_RIGHT_THERE
                })
            }
            if (consts.ROLE_STAFF === getUserFromToken.role.roleType &&
                (consts.ROLE_ADMIN === getUserFromId.role.roleType)) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            return res.status(consts.HTTP_STATUS_OK).json({ data: getUserFromId })
        }
    })
}

export const deleteUserById = async (req, res, next) => {
    const userId = req.params.id
    const token = req.headers.authorization
    if (userId === null || userId === "" || userId === undefined
        || token === null || token === "" || token === undefined) {
        res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ message: 'given user not found. Check inputs.' });
        return
    }
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userFromToken = data.username
            const userRoleFromToken = data.role
            let getUserFromId = await User.getUserById(userId)
            if(getUserFromId === null){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json(
                    {
                        message: 'Given user not found.', error: appText.RESOURCE_NOT_FOUND
                    })
            }
            if (consts.ROLE_SUPER_ADMIN === getUserFromId.role.roleType) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Stop, you are not allowed to do so', error: appText.STOP_RIGHT_THERE
                })
            }
            if (consts.ROLE_STAFF === userRoleFromToken &&
                (consts.ROLE_ADMIN === getUserFromId.role.roleType)) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }

            if (consts.ROLE_STAFF === userRoleFromToken || consts.ROLE_MEMBER ===getUserFromId.role.roleType) {
                if (userFromToken !== getUserFromId.name) {
                    return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                        message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                    })
                }
            }
            getUserFromId.active = false

            await User.updateUser(userId, getUserFromId).then(data => {
                return res.status(consts.HTTP_STATUS_NO_CONTENT).send()
            }).catch(err => {
                error('error',err.stack)
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send(err)
            })

        }
    })
}

export const updateUserById = async (req, res, next) => {
    const userId = req.params.id
    const token = req.headers.authorization
    const active = req.body.active
    const notificationAllowed = req.body.notificationAllowed
    if (userId === null || userId === "" || userId === undefined
        || token === null || token === "" || token === undefined) {
        UserActivity.createUserActivity(token !== undefined ? token : "NOT PROVIDED", Action.UPDATE, "update user failed.")
        res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({ message: 'given user not found. Check inputs.' });
        return
    }
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userFromToken = data.username
            const userRoleFromToken = data.role
            let getUserFromId = await User.getUserById(userId)
            if(getUserFromId === null){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json(
                    {
                        message: 'Given user not found.', error: appText.RESOURCE_NOT_FOUND
                    })
            }
            if (consts.ROLE_SUPER_ADMIN === getUserFromId.role.roleType) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Stop, you are not allowed to do so', error: appText.STOP_RIGHT_THERE
                })
            }
            if (consts.ROLE_STAFF === userRoleFromToken &&
                (consts.ROLE_ADMIN === getUserFromId.role.roleType)) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }

            if (consts.ROLE_STAFF === userRoleFromToken || consts.ROLE_MEMBER ===getUserFromId.role.roleType) {
                if (userFromToken !== getUserFromId.name) {
                    return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                        message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                    })
                }
            }
            getUserFromId.active =  active !== null ? active : true
            getUserFromId.notificationAllowed = notificationAllowed === null ? false: notificationAllowed 
            await User.updateUser(userId, getUserFromId).then(data => {
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err => {
                error('error',err.stack)
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).send(err)
            })

        }
    })
}

export const createUserWithContact = async(req,res, next) =>{
    const username = req.body.username
    const password = req.body.password
    const verifyPassword = req.body.verifyPassword
    const token = req.headers.authorization
    const roleTypeId = req.body.roleType
    const active = req.body.active
    const notificationAllowed = req.body.notificationAllowed
    const emailAddress = req.body.emailAddress
    const phoneNumber = await common.manipulatePhoneNumber(req.body.phoneNumber)
    const streetName = req.body.streetName

    if(password !== verifyPassword){
        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to create new user. Check inputs.' });
        return
    }
    
    const userObj = {
        'username': username,
        'password': password
    }
    const userPayloadCheck = await PayloadCheck.userCreatePayloadCheck(userObj, token)
    if (!userPayloadCheck) {
        res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to create new user. Check inputs.' });
        return
    }
    //verify token
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) {
            return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else {
            const userRoleFromToken = data.role

            if (consts.ROLE_SUPER_ADMIN === userRoleFromToken ||
                consts.ROLE_ADMIN === userRoleFromToken) {
                //get the admin role
                const requestedRole = await Role.findRoleById(roleTypeId)
                if(consts.ROLE_SUPER_ADMIN === requestedRole.roleType){
                    res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                        message: 'Sorry, You do not have rights', error: appText.STOP_RIGHT_THERE
                    })
                    return
                }
                await User.createUser(username, password,
                    requestedRole._id, active,notificationAllowed).then(data => {
                        const createdUser = {
                            name: data.name,
                            active: data.active
                        }
                        //create Contact Info
                        console.log(streetName, phoneNumber, emailAddress, data._id)
                        Contact.createContact(streetName, phoneNumber, emailAddress, data._id).then(d=>{
                            UserActivity.createUserActivity(token, Action.CREATE, "new  user creation successful.")
                            return res.status(consts.HTTP_STATUS_CREATED).json({ data: createdUser })
                        }).catch(err=>{
                            User.deleteUserById(data._id)
                            console.log(err)
                            res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to create new user. Check inputs.', error: err.message })
                            return
                        })
                        
                    })
                    .catch(e => {
                        error('error',e.stack)
                        UserActivity.createUserActivity(token, Action.CREATE, "new  user creation failed.")
                        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({ message: 'Failed to create new user. Check inputs.', error: e.message });
                    })
            } else {
                UserActivity.createUserActivity(token, Action.CREATE, "new  user creation failed.")
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }

        }
    })
}
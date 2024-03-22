'use strict'
const Role = require('../model/role')
const User = require('../model/users')
const PhotoType = require('../model/photoType')
const NotificationType = require('../model/notificationType')
const SocialMedia = require('../model/socialMedia')
const consts = require('../const')
require('dotenv').config()
const logger = require('../model/logger')
const createAdmin = async () => {

    //check whether it already exists or not 
    const roles = await Role.getAllRole();
    if (roles.length > 0) {
    } else {
        //let's create a role
        try {
            await Role.createRole(consts.ROLE_SUPER_ADMIN)
            const adminRole = await Role.getRoleByRoleType(consts.ROLE_SUPER_ADMIN)
            await User.createUser(process.env.ADMIN_USER, process.env.ADMIN_PWD,
                adminRole._id, true, false)
        } catch (e) {
            //something went wrong roll back 
            logger.log('error',e)
            await Role.deleteRole(consts.ROLE_SUPER_ADMIN)
            await User.deleteUserByname(consts.ROLE_SUPER_ADMIN)
        }
    }
}

const createRoles = async () => {
    const adminRole = await Role.getRoleByRoleType(consts.ROLE_ADMIN)
    const staffRole = await Role.getRoleByRoleType(consts.ROLE_STAFF)
    const customerRole = await Role.getRoleByRoleType(consts.ROLE_MEMBER)
    if (!adminRole && !staffRole && !customerRole) {
        try {
            await Role.createRole(consts.ROLE_ADMIN)
            await Role.createRole(consts.ROLE_STAFF)
            await Role.createRole(consts.ROLE_MEMBER)
        } catch (error) {
            logger.log('error',error)
            await Role.deleteRole(consts.ROLE_ADMIN)
            await Role.deleteRole(consts.ROLE_STAFF)
            await Role.deleteRole(consts.ROLE_MEMBER)
        }
    }
}
 

const photoTypes = async () => {
    const photoType= await PhotoType.getPhotoTypes() 
    if(photoType.length ===  0){
        
        try{
            await PhotoType.createPhotoType("Gallery")
            await PhotoType.createPhotoType("Other")
        }catch (err){
            console.log(err)
            logger.log('error',err)
        }
    }
}

const notificationTypes = async () =>{
    const notificationTypes = await NotificationType.getNotificationTypes()
    if(notificationTypes.length === 0){
        try{
            await NotificationType.createNotificationType("marquee")
            await NotificationType.createNotificationType("in-between")
            await NotificationType.createNotificationType("pop-over")
            await NotificationType.createNotificationType("footer-based")
        }catch(err){
            logger.log('error',err)
        }
    }
}

const socialMedia = async () =>{
    const socialMedia = await SocialMedia.getAllSocialMedia()
    if(socialMedia.length === 0){
        try{
            await SocialMedia.createSocialMedia("Facebook")
            await SocialMedia.createSocialMedia("Twitter")
            await SocialMedia.createSocialMedia("Instagram")
            await SocialMedia.createSocialMedia("Whatsapp")
            await SocialMedia.createSocialMedia("Viber")
            await SocialMedia.createSocialMedia("Tiktok")

        }catch(err){
            logger.log('error',err)
        }
    }
}
module.exports = {
    createAdmin,
    createRoles, 
    photoTypes,
    notificationTypes,
    socialMedia
}

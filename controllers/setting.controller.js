'use strict'
const jwtToken = require('../util/jwtToken')
const consts = require('../const')
const appText = require('../applicationTexts.js')
const logger = require('../model/logger')
const Setting = require('../model/setting')

const createSetting = async (req,res,next) =>{
    const token = req.headers.authorization
    const aboutSection = req.body.aboutSection
    const contactInfo = req.body.contactInfo
    const socialMedia = req.body.socialMedia
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
            const prevSetting = await Setting.getSetting().catch(err=>{ 
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, setting creation failed', error: err.stack
                })
            })  
            if(prevSetting.length === 0){
               
                await Setting.createSetting(aboutSection, contactInfo, socialMedia).then(data=>{
                    return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
                }).catch(err=>{
                    logger.log('error',err)
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, setting creation failed', error: err.stack
                    })
                })  
            }else{
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, it can have only one entry for the entire system', error: appText.SETTING_NOT_ALLOWED
                })
            }
            
            
        }
    })
}

const getSetting = async(req,res,next)=>{
    const token = req.headers.authorization 
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
            
            await Setting.getSetting().then(data=>{
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get setting failed', error: err.stack
                })
            }) 
            
        }
    })
}

const getSettingById = async(req,res,next)=>{
    const token = req.headers.authorization 
    const id = req.params.id
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
            
            await Setting.getSettingById(id).then(data=>{
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err=>{
                logger.log('error',err)
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, get setting by id failed', error: err.stack
                })
            }) 
            
        }
    })
}

const updateSettingById = async(req,res,next)=>{
    const token = req.headers.authorization 
    const id = req.params.id
    const aboutSection = req.body.aboutSection
    const contactInfo = req.body.contactInfo
    const socialMedia = req.body.socialMedia
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
            const prevSetting = await Setting.getSettingById(id)
            if(prevSetting.length >0){
                const updateObj = {
                    aboutSection: aboutSection,
                    contactInfo: contactInfo,
                    socialMedia: socialMedia
                }
                console.log(updateObj)
                await Setting.updateSettingById(id, updateObj).then(data =>{
                    return res.status(consts.HTTP_STATUS_OK).json({ data: data })
                }).catch(err=>{
                    logger.log('error',err)
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Sorry, update setting by id failed', error: err.stack
                    })
                }) 
            }else{
                return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                    message: 'Sorry, update setting by id failed', error: err.stack
                })
            }
             
            
        }
    })
}

module.exports={
    createSetting,
    getSetting,
    getSettingById,
    updateSettingById
}
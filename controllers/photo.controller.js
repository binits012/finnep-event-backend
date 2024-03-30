'use strict'
const jwtToken = require('../util/jwtToken')
const logger = require('../model/logger')
const appText = require('../applicationTexts.js')
const consts = require('../const') 
const Photo = require('../model/photo')
const PhotoType = require('../model/photoType')
const fs = require('fs/promises')
const crypto = require('crypto')
const {uploadToS3Bucket} = require('../util/aws')

const createPhoto = async (req, res, next) => {
    const token = req.headers.authorization
    const position = req.body.position
    const image = req.body.image
    const photoType = req.body.photoType
    const imageType =  /image\/\w+/.exec(image)[0]
    const base64Data = new Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), 'base64');
     
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
            const photoTypeObj = await PhotoType.getPhotoTypeById(photoType) 
            if(photoTypeObj.length > 0 ){
                const photoTypeName = photoTypeObj[0].name
                const imageName = photoTypeName+"/"+  crypto.randomUUID()+'.'+imageType.substring(6,9)
                await uploadToS3Bucket(imageType, base64Data, imageName).catch(err=>{
                    logger.log('error',err.stack)
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, something went wrong', error: err
                    })
                })
                const linkToFile = "https://"+process.env.BUCKET_NAME+".s3."+process.env.BUCKET_REGION+".amazonaws.com/" +imageName
                await Photo.uploadPhoto(linkToFile, true, position, photoType).then(data => { 
                    return res.status(consts.HTTP_STATUS_CREATED).json({ data: data })
                }).catch(err => {
                    logger.error(err) 
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, something went wrong', error: err
                    })
                })
            }else{
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    message: 'Sorry, something went wrong', error: err
                })
            } 
        }
    })
}


const getAllPhotos = async (req, res, next) => {
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
            await Photo.listPhoto().then(data => {
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err => {
                logger.error(err) 
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    message: 'Sorry, something went wrong', error: err
                })
            })
        }
    })
    
}
const getPhotoById = async (req, res, next) => {
    const photoId = req.params.id
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
            await Photo.getPhotoById(photoId).then(data => {
                return res.status(consts.HTTP_STATUS_OK).json({ data: data })
            }).catch(err => {
                logger.error(err)
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    message: 'Sorry, something went wrong', error: err
                })
            })
        }
    })    
}
 
const updatePhotoById = async (req, res, next) => {
    const token = req.headers.authorization
    const photoId = req.params.id
    const position = req.body.position
    const publish = req.body.publish
    const photoType = req.body.photoType

    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_STAFF === userRoleFromToken || consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            const myPhoto = await Photo.getPhotoById(photoId)
            if (myPhoto !== null) {
                await Photo.updatePhotoById(photoId, position, publish, photoType).then(data => { 
                    return res.status(consts.HTTP_STATUS_OK).json({ data: data })
                }).catch(err => {
                    logger.error(err) 
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, something went wrong', error: err
                    })
                })
            }

        }
    })
}
const deletePhotoById = async (req, res, next) => {
    const token = req.headers.authorization
    const photoId = req.params.id
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_STAFF === userRoleFromToken || consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }
            const myPhoto = await Photo.getPhotoById(photoId)
            if (myPhoto !== null) {
                await Photo.deletePhotoById(photoId).then(data => {
                    const filePath = __dirname.replace('controllers', 'public/') + data.photoLink
                    fs.unlink(filePath) 
                    return res.status(consts.HTTP_STATUS_OK).send()
                }).catch(err => {
                    logger.error(err)
                    UserActivity.createUserActivity(token, Action.DELETE, "photo delete failed.")
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, something went wrong', error: err
                    })
                })
            }
        }
    })
}

const getAllPhotoForDashboard = async () =>{
   return await Photo.listPhoto()
} 

 
module.exports = {
    createPhoto, 
    getAllPhotos,
    getPhotoById,
    updatePhotoById,
    deletePhotoById, 
    getAllPhotoForDashboard
}

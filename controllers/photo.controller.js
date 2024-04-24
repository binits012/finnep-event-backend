import * as jwtToken from '../util/jwtToken.js'
import {error} from '../model/logger.js'
import * as appText from'../applicationTexts.js'
import * as consts from'../const.js'
import * as Photo from'../model/photo.js'
import * as PhotoType from'../model/photoType.js'
import * as fs from 'fs/promises'
import * as crypto from 'crypto'
import {uploadToS3Bucket} from '../util/aws.js'

export const createPhoto = async (req, res, next) => {
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
                    error('error',err.stack)
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


export const getAllPhotos = async (req, res, next) => {
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
            const photoType = await PhotoType.getPhotoTypes()
            await Photo.listPhoto().then(obj => {
                const data= {
                    photoType:photoType,
                    photo:obj
                }
                return res.status(consts.HTTP_STATUS_OK).json(data)
            }).catch(err => {
                logger.error(err) 
                return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                    message: 'Sorry, something went wrong', error: err
                })
            })
        }
    })
    
}

export const getPhotoById = async (req, res, next) => {
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
 
export const updatePhotoById = async (req, res, next) => {
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
export const deletePhotoById = async (req, res, next) => {
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
            console.log(myPhoto)
            if (myPhoto !== null) {
                await Photo.deletePhotoById(photoId).then(data => {
                    /*
                    const filePath = __dirname.replace('controllers', 'public/') + data.photoLink
                    fs.unlink(filePath) 
                    */
                    return res.status(consts.HTTP_STATUS_OK).send()
                }).catch(err => {
                    logger.error(err) 
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, something went wrong', error: err
                    })
                })
            }else{
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, photo not found.', error: appText.RESOURCE_NOT_FOUND
                })
            }
        }
    })
}

export const getAllPhotoForDashboard = async () =>{
   return await Photo.listPhoto()
} 

export const getGalleryPhoto = async () =>{
    return  await Photo.getGalleryPhoto()
}
  

import * as jwtToken from '../util/jwtToken.js'
import {error} from '../model/logger.js'
import * as appText from'../applicationTexts.js'
import * as consts from'../const.js'
import * as Photo from'../model/photo.js'
import * as PhotoType from'../model/photoType.js' 
import * as crypto from 'crypto'
import {uploadToS3Bucket} from '../util/aws.js'
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";   
import * as commonUtil from '../util/common.js' 
import redisClient from '../model/redisConnect.js'
 
const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;
const keyPairId = process.env.CLOUDFRONT_KEY_PAIR;

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
                //dateLessThan, dateGreaterThan, url, keyPairId, privateKey, ipAddress, policy, passphrase, 
                const signedUrl = getSignedUrl({dateLessThan: Math.floor(Date.now() / 1000) + 3600*24, // Expires in 24 hour,
                    dateGreaterThan:Date.now(),
                    url:  process.env.CLOUDFRONT_URL+"/"+imageName,
                    keyPairId, 
                    privateKey
                });
                const linkToFile = "https://"+process.env.BUCKET_NAME+".s3."+process.env.BUCKET_REGION+".amazonaws.com/" +imageName
                await Photo.uploadPhoto(linkToFile, true, position, photoType).then(data => { 
                    const cacheKey = `signedUrl:${data.id}`;
                    const cached = commonUtil.getCacheByKey(redisClient, cacheKey);

                    if (cached && cached.url && cached.expiresAt > Date.now()) {
                        // Use cached.url
                        data.photoLink = cached.url;
                    } else {
                        // Generate new signed URL
                        const expiresInSeconds = 7 * 24 * 60 * 60; // e.g., 7 days
                        const signedUrl = getSignedUrl({  
                            keyPairId, 
                            privateKey,
                            policy:policyString
                        });
                        const expiresAt = Date.now() + expiresInSeconds * 1000;

                        // Store in cache
                        commonUtil.setCacheByKey(redisClient, cacheKey, { url: signedUrl, expiresAt });
                        redisClient.expire(cacheKey, expiresInSeconds);

                        data.photoLink = signedUrl
                    }
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
            await Photo.listPhoto().then( async obj => {
                const photosWithCloudFrontUrls = await Promise.all(obj.map(async photo => {
                    
                    const cacheKey = `signedUrl:${photo.id}`;
                    const cached = await commonUtil.getCacheByKey(redisClient, cacheKey);
                      
                    if (cached && cached.url && cached.expiresAt > Date.now()) {
                        photo.photoLink = cached.url;
                    } else {
                        // Generate new signed URL
                        const expiresInSeconds = 29 * 24 * 60 * 60; // e.g., 29 days
                         
                        const signedUrl = await commonUtil.getCloudFrontUrl(photo.photoLink)
                        const expiresAt = Date.now() + expiresInSeconds * 1000;

                        // Store in cache
                        await commonUtil.setCacheByKey(redisClient, cacheKey, { url: signedUrl, expiresAt });
                        redisClient.expire(cacheKey, expiresInSeconds);

                        photo.photoLink = signedUrl
                    }
                    return photo
                }));
                console.log("photosWithCloudFrontUrls",  photosWithCloudFrontUrls)
                const data = {
                    photoType: photoType,
                    photo:  photosWithCloudFrontUrls
                }
                return res.status(consts.HTTP_STATUS_OK).json(data)
            }).catch(err => { 
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
                const photoLink = data.photoLink.replace(
                    /https?:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com/,
                    process.env.CLOUDFRONT_URL
                )
                const signedUrl = getSignedUrl({
                    url:  photoLink,
                    keyPairId,
                    dateLessThan: Math.floor(Date.now() / 1000) + 3600*24, // Expires in 24 hour,
                    privateKey
                });
                data.photoLink = signedUrl
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
                await Photo.updatePhotoById(photoId, position, publish, photoType).then(async data => {  
                
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
            if (myPhoto !== null) {
                await Photo.deletePhotoById(photoId).then(data => {
                    const photoLink = data.photoLink.replace(
                        /https?:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com/,
                        process.env.CLOUDFRONT_URL
                    )
                    const signedUrl = getSignedUrl({
                        url:  photoLink,
                        keyPairId,
                        dateLessThan: Math.floor(Date.now() / 1000) + 3600*24, // Expires in 24 hour,
                        privateKey
                    });
                    data.photoLink = signedUrl 
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
  

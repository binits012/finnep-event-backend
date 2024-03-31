'use strict'
require('dotenv').config() 
const { S3Client,PutObjectCommand } = require("@aws-sdk/client-s3")
const {Upload} = require("@aws-sdk/lib-storage")
const logger = require('../model/logger') 

const options = {
    partSize: 4 * 1024 * 1024, //4mb
    queueSize: 4,
  };
const s3Client = new S3Client({
    bucket:process.env.BUCKET_NAME,
    region: process.env.BUCKET_REGION,
    credentials: {
    accessKeyId: process.env.BUCKET_ACCESS_CLIENT,
    secretAccessKey: process.env.BUCKET_ACCESS_KEY,
    } 
})

const uploadToS3Bucket = async (fileType, fileContent, pathToS3) =>{
     
    await s3Client.send(
        new PutObjectCommand({ 
            Bucket:process.env.BUCKET_NAME,
            Key:pathToS3,
            ContentType: fileType,
            Body:fileContent
        })
    ).catch(err=>{
        logger.log('error',err.stack) 
    }) 
    logger.log('info', "sending %s photo to bucket end at %s",pathToS3 ,new Date())
  }

const streamBasedParallelUpload = async(fileType,key, streamObj) =>{
 
    const parallelUploads3 = new Upload({
        client: s3Client,
        params: {
            Bucket: process.env.BUCKET_NAME,
            Key: key,
            ContentType: fileType,
            Body: streamObj
        },
        queueSize:4,
        partSize:1024*1024*5, //5mb
        leavePartsOnError: false

    })

    parallelUploads3.on("httpUploadProgress", (progress) => {
        console.log(progress)
        logger.log('info', "sending %s photo to bucket end at %s",key ,new Date())
    })
    
    await parallelUploads3.done()
    
}

module.exports = {
    uploadToS3Bucket,
    streamBasedParallelUpload
}
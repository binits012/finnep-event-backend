'use strict'
require('dotenv').config() 
const { S3Client,PutObjectCommand } = require("@aws-sdk/client-s3")
const logger = require('../model/logger')
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
     
  }


module.exports = {
    uploadToS3Bucket
}
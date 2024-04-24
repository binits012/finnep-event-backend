import dotenv from 'dotenv'
dotenv.config()
import { S3Client,PutObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import {error, info} from '../model/logger.js'
const s3Client = new S3Client({
    bucket:process.env.BUCKET_NAME,
    region: process.env.BUCKET_REGION,
    credentials: {
    accessKeyId: process.env.BUCKET_ACCESS_CLIENT,
    secretAccessKey: process.env.BUCKET_ACCESS_KEY,
    } 
})

export const uploadToS3Bucket = async (fileType, fileContent, pathToS3) =>{
     
    await s3Client.send(
        new PutObjectCommand({ 
            Bucket:process.env.BUCKET_NAME,
            Key:pathToS3,
            ContentType: fileType,
            Body:fileContent
        })
    ).catch(err=>{
        error('error',err.stack) 
    }) 
    info( "sending %s photo to bucket end at %s",pathToS3 ,new Date())
  }

export const streamBasedParallelUpload = async(fileType,key, streamObj) =>{
 
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
        info( "sending %s photo to bucket end at %s",key ,new Date())
    })
    
    await parallelUploads3.done()
    
}
/*
module.exports = {
    uploadToS3Bucket,
    streamBasedParallelUpload
}
*/
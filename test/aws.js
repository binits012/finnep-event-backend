 'use strict'
  require('dotenv').config() 
  const fs = require("fs")
  import { S3Client,PutObjectCommand } from "@aws-sdk/client-s3"

  const s3Client = new S3Client({
    bucket:process.env.BUCKET_NAME,
    region: process.env.BUCKET_REGION,
     credentials: {
        accessKeyId: process.env.BUCKET_ACCESS_CLIENT,
        secretAccessKey: process.env.BUCKET_ACCESS_KEY,
     } 
  })

  const uploadToS3 = async () =>{
    console.log(__dirname+'/nuppu.jpeg')
    const fileContent = fs.readFileSync(__dirname+'/nuppu.jpeg')
    console.log(fileContent)
    /* 
    await s3Client.send(
        new PutObjectCommand({ 
            Bucket:process.env.BUCKET_NAME,
            Key:'nuppu/nuppu.jpeg',
            ContentType: "image/jpeg",
            Body:fileContent
        })
    ).catch(err=>{
        console.log(err)
    })
    */
     
  }

  uploadToS3()
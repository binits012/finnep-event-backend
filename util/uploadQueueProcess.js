const { Worker } = require('bullmq')
const logger = require('../model/logger')
const fs = require('fs').promises
const consts = require('../const')
require('dotenv').config()
const {uploadToS3Bucket,streamBasedParallelUpload} = require('./aws')
const Event = require('../model/event')
const path = require('path')
const worker = new Worker(consts.PHOTO_ARRIVAL_QUEUE, async job => {
    //get the information of the job 
    const eventId = job.data.event._id
    const eventName = job.data.event.eventName
    const fileInfo = job.data.fileInfo 
    let shouldContinue = true
    let photoLinkArray =[]
    for(let index in fileInfo){
       const data = fileInfo[index]
       const fileName = data.fileName
       const ct = data.contentType
       const streamData = Buffer.from(data.content)
       const pathToS3 = eventName+'/'+fileName
       const linkToFile = "https://"+process.env.BUCKET_NAME+".s3."+process.env.BUCKET_REGION+".amazonaws.com/" +pathToS3
       photoLinkArray.push(linkToFile)
       logger.log('info', "sending photo to bucket starts at "+ new Date()) 
       if(streamData.lenght > (1024*1024*5)){
        await streamBasedParallelUpload(ct, pathToS3, streamData ).catch(err=>{
            logger.log('error', err.stack)
            shouldContinue = false
        }) 
       }else{
        await uploadToS3Bucket(ct, streamData, pathToS3).catch(err=>{
            logger.log('error', err.stack)
            shouldContinue = false
        })
       } 
    }
    if(shouldContinue){ 
        for(let i in photoLinkArray){
            job.data.event.eventPhoto.push(photoLinkArray[i])
        }
        //remove duplicates
        const photoArray = [...new Set(job.data.event.eventPhoto)]
        job.data.event.eventPhoto = photoArray
        await Event.updateEventById(eventId,job.data.event).catch(err=>{
            logger.log('error',err.stack)
        })
          
        logger.log('info', "the whole job completes at "+ new Date()) 
    }

}, {
    connection: {
      host: process.env.REDIS_HOST, port: process.env.REDIS_PORT, no_ready_check: true,
      password: process.env.REDIS_PWD
    }
  })
  worker.on('completed', job => {
    logger.log('info','%s has completed!',job.id) 
  });
  worker.on("error", (err) => {
    console.log(err)
    logger.log('error',err)
  })
  worker.on('failed', (job, err) => { 
    console.log(err)
    logger.log('error','%s has failed with %s', job.id, err.message)
  })

//System related calls
const gracefulShutdown = async (signal) => {
    console.log(`Received ${signal}, closing server...`)
    await worker.close()
  }
  
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
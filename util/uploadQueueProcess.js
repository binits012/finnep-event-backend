import { Worker } from 'bullmq'
import {error, info} from '../model/logger.js'
import * as consts from '../const.js'
import dotenv from 'dotenv'
dotenv.config()
import {uploadToS3Bucket,streamBasedParallelUpload} from './aws.js'
import * as Event from '../model/event.js' 
import * as hash from './createHash.js' 
import * as Ticket from '../model/ticket.js' 
import * as Excel from 'exceljs'
import {createCode} from '../util/common.js'
import {createOrderTicket} from '../model/orderTicket.js'
const workbook = new Excel.default.Workbook()
const SYTEM_GENERATED_EMAIL = "system-generated-ticket@weyellowbridge.com"

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
       info(  "sending photo to bucket starts at "+ new Date()) 
       if(streamData.lenght > (1024*1024*5)){
        await streamBasedParallelUpload(ct, pathToS3, streamData ).catch(err=>{
            error('error', err.stack)
            shouldContinue = false
        }) 
       }else{
        await uploadToS3Bucket(ct, streamData, pathToS3).catch(err=>{
            error('error', err.stack)
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
            error('error',err.stack)
        })
          
        info(  "the whole job completes at "+ new Date()) 
    }

}, {
    connection: {
      host: process.env.REDIS_HOST, port: process.env.REDIS_PORT, no_ready_check: true,
      password: process.env.REDIS_PWD
    }
  })
  worker.on('completed', job => {
    info( '%s has completed!',job.id) 
  });
  worker.on("error", (err) => {
    console.log(err)
    error('error',err.stack)
  })
  worker.on('failed', (job, err) => { 
    console.log(err)
    error('error','%s has failed with %s', job.id, err.message)
  })
 
//create ticket via fileUpload
const ticketViaFileUpload = new Worker(consts.CREATE_TICKET_FROM_FILE_UPLOAD, async job =>{
  info( "bullmq processing excel starts at "+ Date.now()) 
  const jobData = job.data 
  try {
    const dataFromFile = await readFile(jobData.fileLocation)
    const event = await Event.getEventById(jobData.eventId)
    
    dataFromFile.forEach( async e=>{
      const ticketFor = e.contactData
      let code = e.code
      let typeOfTicket = e.type
      
      const getOrCreateHash = async (value, type = 'email') => {
        const crypto = await hash.getCryptoBySearchIndex(value, type)
        if (crypto.length === 0) {
          const tempHash = await hash.createHashData(value, type)
          return tempHash._id
        }
        return crypto[0]._id
      }

      const phoneHash = await getOrCreateHash(ticketFor, 'phone')
      const emailHash = await getOrCreateHash(SYTEM_GENERATED_EMAIL, 'email')
      if(code !== 'undefined' || code !==""){
        //system should not have the same code, duplicate codes shall not be entertained
        const ticket = await Ticket.genericSearch({otp:code})
        if(ticket){
          info(' duplicate codes %s for %s ', code, jobData.eventId,)
          return null
        }
      }
      if (typeof typeOfTicket === 'undefined' || typeOfTicket === '' || typeOfTicket === null) typeOfTicket = 'system generated'
       
      if(typeof code === 'undefined' || code === '' ) {
        code = await createCode(10) 
      }

      const eventPrice = event.ticketInfo.filter(e => typeOfTicket === e.name).map(e => e.price)  
      const tempTicketOrderObj = {
          eventName: event.eventTitle,
          eventId: jobData.eventId,
          price: eventPrice?.[0] || 1.0,
          quantity: 1,
          ticketType: typeOfTicket,
          totalPrice: eventPrice?.[0] || 1.0,
          phone: phoneHash,
          email: emailHash
      } 
      const ticketOrder = await createOrderTicket(code, tempTicketOrderObj) 
      // create a ticket
      const ticket = await Ticket.createTicket(null, phoneHash, event,typeOfTicket,ticketOrder.ticketInfo, code) 
      await Ticket.updateTicketById(ticket.id, { isSend: true }) 
       
    })
  } catch (err) {
    console.log(err)
  }
  
},
{
  connection: {
    host: process.env.REDIS_HOST, port: process.env.REDIS_PORT, no_ready_check: true,
    password: process.env.REDIS_PWD
  }
})
ticketViaFileUpload.on('completed', job => {
  info( '%s has completed!',job.id) 
  info(  "bullmq processing excel completes at "+ Date.now())
})
ticketViaFileUpload.on("error", (err) => {
  console.log(err)
  error('error',err)
})
ticketViaFileUpload.on('failed', (job, err) => { 
  error('error','%s has failed with %s', job.id, err.message)
})

//private method
const readFile = async (fileLocation) =>{
  let idSet = new Array() 
  await workbook.xlsx
		.readFile(fileLocation)
		.then(() => {
			let worksheet = workbook.getWorksheet('Tickets')
      if (!worksheet) {
        error('error', 'Worksheet not found')
        return idSet
      };
			worksheet.eachRow({ includeEmpty: true }, function(row, rowNumber) {
				if (rowNumber > 1 && row.values.length > 0) {
          const val = row.values 
          const fileData = {
            contactData:val[2],
            code:val[3],
            type:val[4]
          }
          idSet.push(fileData);
        }
			})
		})
		.catch((err) => {
			error('error', err)
		})
		.finally(() => { 
			return idSet
		})
  return idSet
}

//System related calls
const gracefulShutdown = async (signal) => {
    console.log(`Received ${signal}, closing server...`)
    await worker.close() 
    await ticketViaFileUpload.close()
}
  
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
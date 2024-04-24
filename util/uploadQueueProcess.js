import { Worker } from 'bullmq'
import {error, info} from '../model/logger.js'
import * as consts from '../const.js'
import dotenv from 'dotenv'
dotenv.config()
import {uploadToS3Bucket,streamBasedParallelUpload} from './aws.js'
import * as Event from '../model/event.js'
import {TicketReport} from '../model/reporting.js'
import * as hash from './createHash.js'
import * as ticketMaster from './ticketMaster.js'
import * as Ticket from '../model/ticket.js'
import * as sendMail from '../util/sendMail.js'
import * as Excel from 'exceljs'
const workbook = new Excel.default.Workbook()


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
      const ticketFor = e.emailId
      let typeOfTicket = e.type
      const emailCrypto = await hash.getCryptoByEmail(ticketFor)
      let emailHash = null
      if (emailCrypto.length == 0) {
        //new email which is not yet in the system
        let tempEmailHash = await hash.createHashData(ticketFor, 'email')
        emailHash = tempEmailHash._id
      } else {
        emailHash = emailCrypto[0]._id
      }
      if (typeOfTicket === 'undefined' || typeOfTicket === '' || typeOfTicket === null) typeOfTicket = 'normal'
      // create a ticket
      const ticket = await Ticket.createTicket(null, emailHash, event,typeOfTicket) 
      const emailPayload = await ticketMaster.createEmailPayload(event, ticket, ticketFor) 
      await sendMail.forward(emailPayload).then(async data => {
        //all good let's update the ticket model once more
        console.log("email sent data \n", data)
        await Ticket.updateTicketById(ticket.id, { isSend: true }) 
        
      }).catch(err => {
        //let's not dump the hard work, we will try to send the mail in a while later
        error('error', err.stack)

        if(ticket !== null || ticket !=='undefined'){
          const reportStatus = {
            ticketId: ticket.id,
            isSend:false,
            retryCount:0
          }
          const reporting = TicketReport(reportStatus)
          reporting.save()
        }
        
      })
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
			let worksheet = workbook.getWorksheet('Sheet1');
			worksheet.eachRow({ includeEmpty: true }, function(row, rowNumber) {
				if (rowNumber > 1 && row.values.length > 0) {
          const val = row.values 
          const fileData = {
            emailId:val[2],
            type:val[3]
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
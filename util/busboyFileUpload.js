const busboy = require('busboy')
const fs = require('fs')
const logger = require('../model/logger')
const { Queue } = require('bullmq')  
const consts = require('../const')
require('dotenv').config()
const Event = require('../model/event')
const uploadArrivalPhotoQueue = new Queue(consts.PHOTO_ARRIVAL_QUEUE,  {connection :{host:process.env.REDIS_HOST,
    port:process.env.REDIS_PORT,no_ready_check: true,
password:process.env.REDIS_PWD}})

const ticketViaFileUploadQueue = new Queue(consts.CREATE_TICKET_FROM_FILE_UPLOAD,  {connection :{host:process.env.REDIS_HOST,
    port:process.env.REDIS_PORT,no_ready_check: true,
password:process.env.REDIS_PWD}})

const uploadToS3 = async(event, req, callback) =>{
    //lets start parsing the file 

    const bb = busboy({headers:req.headers,limits: {
        fileSize: 2*1024*1024*1024  //max 2gb size
    } })
    let fileInfo = []
    bb.on('error', err=>{ console.log(err); callback(false, true)}) 
    bb.on('file', async (name,file,info) =>{
        logger.log('info', "busboy receiving photo starts at "+ new Date())
        const { filename, encoding, mimeType } = info
        if(filename.length > 0){
            if(mimeType != 'image/png' && mimeType != 'image/jpeg' && mimeType != 'image/jpg'){ 
                //Ignore the upload, move on to next one
                file.resume()
            }
            let streamData = []
            console.log('sending image data starts at ', new Date())
            
            file.on('data', (data) => {
                streamData.push(data)
              }).on('close', () => {
                //storing the uploaded photo
                try{
                    const tempFileName = __dirname.replace('util','') +  'tmp/'+ filename
                    const tempFileInfo = {
                        fileName: filename,
                        path:tempFileName,
                        contentType:mimeType,
                        content: Buffer.concat(streamData)
                    } 
                    fileInfo.push(tempFileInfo) 
                    streamData = []
                }catch(err){
                    console.log(err)
                    logger.log('error', err)
                }
              })
            
            
        }else{
            file.resume()
        }
       
    }) 
   
    bb.on('finish', () =>{
        
        const jobData = {
            event:event,
            fileInfo: fileInfo
        } 
        uploadArrivalPhotoQueue.add(trimAllWhiteSpaces(event.eventTitle)+'-'+event.id,jobData,
            {
                removeOnComplete: {
                age: 3600, // keep up to 1 hour
                count: 100, // keep up to 1000 jobs
                },
                removeOnFail: {
                age: 24 * 3600, // keep up to 24 hours
                },
                delay: 1000 //1 second delay
            }
        )
        logger.log('info', "busboy receiving photo ends at "+ new Date())
        callback(true, null)
    })
    req.pipe(bb)
}

const trimAllWhiteSpaces = (str) =>{
    let newStr = ""
    for(let char of str){
        if(!/\s/.test(char)){
            newStr += char
        }
    }
    return newStr
}
const createTicketViaFile = async(req) =>{
    await createFileFolder('excelFiles')
    let saveTo = null
    let eventId = null
    return await new Promise((resolve, reject) =>{
        const bb = busboy({headers:req.headers,limits: {
            fileSize: 20*1024*1024  //max 20mb size
        } })
        bb.on('error', err=>{ console.log(err); callback(false, true)}) 
        bb.on('file', async (name,file,info) =>{
            logger.log('info', "busboy receiving excel starts at "+ Date.now())
            const { filename, encoding, mimeType } = info
            console.log(info)
            if(filename.length > 0){
                if(mimeType != 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'  ){ 
                    reject(false)
                    return
                }
            } 
            saveTo = __dirname.replace('util','')+'/excelFiles/'+Date.now()+`-excelUpload-${filename}`
            file.pipe(fs.createWriteStream(saveTo))
        }) 

        bb.on('field', (name, val, info) => {
             if('event' === name){
                eventId = val
             }
          })
       
        bb.on('finish', async() =>{
            try{
                const event = await Event.getEventById(eventId).catch(err=>{ 
                    logger.log('error', err.stack)
                    reject(false)  
                })
                const jobData = {
                    eventId:event.id,
                    fileLocation: saveTo
                } 
                ticketViaFileUploadQueue.add(event.id+'-'+Date.now(),jobData,
                    {
                        removeOnComplete: {
                        age: 3600, // keep up to 1 hour
                        count: 100, // keep up to 1000 jobs
                        },
                        removeOnFail: {
                        age: 24 * 3600, // keep up to 24 hours
                        },
                        delay: 1000 //1 second delay
                    }
                )
                logger.log('info', "busboy receiving excel ends at "+ Date.now()) 
                resolve(true)
            }catch(err){
                reject(false)
            }
            
        })
        req.pipe(bb)
    })
}

const createFileFolder = async (dir) => {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir);
	}
}
module.exports = {
     uploadToS3,
     createTicketViaFile
}
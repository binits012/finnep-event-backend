const busboy = require('busboy')
const fs = require('fs')
const logger = require('../model/logger')
const { Queue } = require('bullmq')  
const consts = require('../const')
require('dotenv').config()
const uploadArrivalPhotoQueue = new Queue(consts.PHOTO_ARRIVAL_QUEUE,  {connection :{host:process.env.REDIS_HOST,
    port:process.env.REDIS_PORT,no_ready_check: true,
password:process.env.REDIS_PWD}})


const saveFileLocally = async(event, req, callback) =>{
    //lets start parsing the file 
    const bb = busboy({headers:req.headers,limits: {
        fileSize: 2*1024*1024*1024  //max 2gb size
    } })
    logger.log('info', "writing photo locally starts at "+ new Date())
    let fileInfo = []
    bb.on('error', err=>{ console.log(err); callback(false, true)}) 
    bb.on('file', async (name,file,info) =>{
        const { filename, encoding, mimeType } = info
        if(filename.length > 0){
            if(mimeType != 'image/png' && mimeType != 'image/jpeg' && mimeType != 'image/jpg'){ 
                //Ignore the upload, move on to next one
                file.resume()
            }
            let streamData = []
            console.log('streaming data starts at ', new Date())
            
            file.on('data', (data) => {
                streamData.push(data)
              }).on('close', () => {
                //storing the uploaded photo
                try{
                    const tempFileName = __dirname.replace('util','') +  '/tmp/'+ filename
                    const tempFileInfo = {
                        fileName: filename,
                        path:tempFileName,
                        contentType:mimeType
                    } 
                    fileInfo.push(tempFileInfo) 
                    fs.writeFile(tempFileName,Buffer.concat(streamData),async()=>{
                        console.log('streaming data save to file ends at ', new Date())
                        streamData = []
                    }) 
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
        uploadArrivalPhotoQueue.add(event.eventName+'-'+event.id,jobData,
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
        logger.log('info', "writing photo locally ends at "+ new Date())
        callback(true, null)
    })
    req.pipe(bb)
}


module.exports = {
    saveFileLocally
}
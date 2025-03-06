import * as fs from 'fs/promises'; 
import * as ICS from 'ics'
import * as QRCode from 'qrcode'
import { validationResult } from 'express-validator'
import  {ObjectId} from 'mongodb'
import moment from 'moment-timezone'
import dotenv from 'dotenv'
dotenv.config()

export const manipulatePhoneNumber = async (phoneNumber) =>{
    if(/[aA-zZ].*/.test(phoneNumber)){
        return null
    }
    let sanitaizedPhoneNumber = phoneNumber.replaceAll("-","").replaceAll("(","").replaceAll(")","")
    if(sanitaizedPhoneNumber.startsWith('+358')) {
         //probably this is ok 
        return phoneNumber 
    }
    if(sanitaizedPhoneNumber.startsWith('0')){
        sanitaizedPhoneNumber = sanitaizedPhoneNumber.replace('0','')
        sanitaizedPhoneNumber = process.env.PREFIX_PHONE+sanitaizedPhoneNumber
        return sanitaizedPhoneNumber
    } 
    if(sanitaizedPhoneNumber.startsWith('4') || sanitaizedPhoneNumber.startsWith('5') ){
        sanitaizedPhoneNumber = process.env.PREFIX_PHONE+sanitaizedPhoneNumber
        return sanitaizedPhoneNumber
    }
    return phoneNumber
     
}

export const formatDate = async (dateString) =>{
    const dateSplit = dateString.split('/')
    const day = dateSplit[0]
    const month = dateSplit[1]
    const year = dateSplit[2]
    const tempString = year+"-"+month+"-"+day
    return tempString
}

export const formateDateWithHash = async (date) =>{ 
    return  moment(date).format("DD/MM/YYYY")
}

export const convertDateTimeWithTimeZone = async (eventDate) =>{ 
    return  moment(eventDate).tz('UTC').format('YYYY-MM-DDTHH:mm:ss')
}
//redis-client
export const getCacheByKey = async(redisClient, key) =>{ 
    try{
        return JSON.parse(await redisClient.get(key))
    }catch(error){
        console.log(error)
        return error
    }
    
}

export const setCacheByKey = async(redisClient, key, data) =>{
    try{
        return await redisClient.set(key, JSON.stringify(data))
    }catch(error){ 
        return error
    }
   
}

export const removeCacheByKey = async(redisClient, key) =>{
    return await redisClient.del(key);
}

export const formatTime =  (time) =>{
    let hour = Math.floor(time/60)
    let min = time%60
    if(min < 10) min = '0'+min
    if(hour<10) hour = '0'+hour;
    return hour+':'+min
}

export const timeInMinutes = (time) =>{
    const hour = parseInt(time.substring(0, 2)) * 60
    const min = time.substring(3, 5)
    return hour + parseInt(min)
}

export const sanitizeLanguage = (lang) =>{
    let myLang = 'en'
    switch (lang) {
        case 'Finnish': 
        case 'fi':
            myLang = 'fi'
          break
        
        case 'Swedish':
        case 'sv':
            myLang = 'sv'
          break;
        default:
          myLang = 'en'
      }
    return myLang
}

export const sortByDate = (a, b) =>{ 
    return Date.parse(b.reservationDate) - Date.parse(a.reservationDate)
}


export const validateParam = async (id) =>{
    return ObjectId.isValid(id) 
}

export  const validate = async (validations, req) => { 
    
    for (let validation of validations) {
        
        const result = await validation.run(req)
        if (result.errors.length)  break
    } 
    
    return validationResult(req)    
  }

export  const generateQRCode = async(ticketId) =>{
    let opts = {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        quality: 0.3,
        margin: 1,
        color: {
          dark:"#010599FF",
          light:"#FFBF60FF"
        }
    }
    return await new Promise((resolve, reject)=>{
        QRCode.toDataURL(ticketId, opts, function (err, url) {
             
            if(err) reject(err)
            resolve(url)
        })
    })
    /*
    QRCode.toDataURL(process.env.FQDN+'/api/ticket/'+ticketId, opts, function (err, url) {
        callback(err,url)
    })
    */
}
export  const generateICS = async(event, ticketId)=>{
    const eventDate = event.eventDate
    const start = moment(eventDate).utc().format('YYYY-MM-DD-HH-mm-ss').split("-").map((a) => parseInt(a))  
    const eventGeoCode = event.eventLocationGeoCode.split(',')
    const icsData = {
        title: event.eventTitle,
        description: event.eventDescription,
        busyStatus: 'Busy',
        location:event.eventLocationAddress,
        geo:{ lat: parseFloat(eventGeoCode[0]) , lon: parseFloat(eventGeoCode[1].trim()) },
        start: start,
        duration: {hours: 5, minutes: 0 },
        status:'CONFIRMED',
        classification:'PRIVATE',
        organizer: { name: process.env.COMPANY_TITLE, email: process.env.EMAIL_USERNAME },
        uid:ticketId
    } 
    return await new Promise((resolve, reject)=>{
        ICS.createEvent(icsData, async(err, value)=>{
            if(err) reject(err)
            resolve(value)
       })
    }) 

}

export  const loadEmailTemplate = async (fileLocation, eventTitle,eventPromotionalPhoto, qrCode, otp) => {
    console.log("=====>", otp)
    const emailData = (await fs.readFile(fileLocation,'utf8')).replace('$eventTitle',eventTitle).replace('$eventTitle',eventTitle)
    .replace('$eventTitle',eventTitle)
    .replace('$eventPromotionalPhoto',eventPromotionalPhoto)
    .replace('$qrcodeData',qrCode) 
    .replace('$ticketCode',otp) 
    return emailData
  }
 
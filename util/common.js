'use strict'
require('dotenv')
const moment = require('moment-timezone')
const {ObjectId} = require('mongodb')
const { validationResult } = require('express-validator')
var QRCode = require('qrcode')
const ICS = require('ics')
const fs = require('fs').promises

const manipulatePhoneNumber = async (phoneNumber) =>{
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

const formatDate = async (dateString) =>{
    const dateSplit = dateString.split('/')
    const day = dateSplit[0]
    const month = dateSplit[1]
    const year = dateSplit[2]
    const tempString = year+"-"+month+"-"+day
    return tempString
}

const formateDateWithHash = async (date) =>{ 
    return  moment(date).format("DD/MM/YYYY")
}

const convertDateTimeWithTimeZone = async (eventDate) =>{ 
    return  moment(eventDate).tz(process.env.TIME_ZONE).format('YYYY-MM-DDTHH:mm:ss')
}
//redis-client
const getCacheByKey = async(redisClient, key) =>{ 
    try{
        return JSON.parse(await redisClient.get(key))
    }catch(error){
        console.log(error)
        return error
    }
    
}

const setCacheByKey = async(redisClient, key, data) =>{
    try{
        return await redisClient.set(key, JSON.stringify(data))
    }catch(error){ 
        return error
    }
   
}

const removeCacheByKey = async(redisClient, key) =>{
    return await redisClient.del(key);
}

const formatTime =  (time) =>{
    let hour = Math.floor(time/60)
    let min = time%60
    if(min < 10) min = '0'+min
    if(hour<10) hour = '0'+hour;
    return hour+':'+min
}

const timeInMinutes = (time) =>{
    const hour = parseInt(time.substring(0, 2)) * 60
    const min = time.substring(3, 5)
    return hour + parseInt(min)
}

const sanitizeLanguage = (lang) =>{
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

const sortByDate = (a, b) =>{ 
    return Date.parse(b.reservationDate) - Date.parse(a.reservationDate)
}


const validateParam = async (id) =>{
    return ObjectId.isValid(id) 
}

const validate = async (validations, req) => { 
    
    for (let validation of validations) {
        
        const result = await validation.run(req)
        if (result.errors.length)  break
    } 
    
    return validationResult(req)    
  }

const generateQRCode = async(ticketId) =>{
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
        QRCode.toDataURL(process.env.FQDN+'/api/ticket/'+ticketId, opts, function (err, url) {
             
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
const generateICS = async(event, ticketId)=>{
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

const loadEmailTemplate = async (fileLocation, eventTitle,eventPromotionalPhoto, qrCode) => {
    const emailData = (await fs.readFile(fileLocation,'utf8')).replace('$eventTitle',eventTitle).replace('$eventTitle',eventTitle)
    .replace('$eventTitle',eventTitle)
    .replace('$eventPromotionalPhoto',eventPromotionalPhoto)
    .replace('$qrcodeData',qrCode) 
    return emailData
  }
module.exports = {
    manipulatePhoneNumber,
    formatDate,
    getCacheByKey,
    setCacheByKey,
    removeCacheByKey,
    formatTime,
    formateDateWithHash,
    timeInMinutes,
    sanitizeLanguage,
    sortByDate,
    validateParam,
    validate,
    convertDateTimeWithTimeZone,
    generateQRCode,
    generateICS,
    loadEmailTemplate
    
}

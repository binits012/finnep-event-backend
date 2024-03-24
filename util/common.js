'use strict'
require('dotenv')
const moment = require('moment')
const {ObjectId} = require('mongodb')
const { validationResult } = require('express-validator')
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
    console.log(validationResult(req)  )
    return validationResult(req)    
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
    validate
}

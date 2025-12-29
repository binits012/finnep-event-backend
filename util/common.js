import * as fs from 'fs/promises';
import * as ICS from 'ics'
import * as QRCode from 'qrcode'
import { validationResult } from 'express-validator'
import  {ObjectId} from 'mongodb'
import moment from 'moment-timezone'
import dotenv from 'dotenv'
import crypto from 'crypto'
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { compileMjmlTemplate } from './emailTemplateLoader.js';
const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY
const keyPairId = process.env.CLOUDFRONT_KEY_PAIR
dotenv.config()
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789';
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

export const convertDateTimeWithTimeZone = async (eventDate, eventTimeZone = "Europe/Helsinki") =>{
    return  moment(eventDate).tz(eventTimeZone).format('YYYY-MM-DDTHH:mm:ss')
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
    const eventTimezone = event.eventTimezone || 'UTC' // Use event timezone, fallback to UTC
    const start = moment(eventDate).tz(eventTimezone).format('YYYY-MM-DD-HH-mm-ss').split("-").map((a) => parseInt(a))
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

export  const loadEmailTemplate = async (fileLocation, variablesOrEventTitle, eventPromotionalPhoto, qrCodeRef, otp) => {
    // Replace .html with .mjml in file path
    const mjmlPath = fileLocation.replace('.html', '.mjml');

    // Check if first parameter after fileLocation is an object (new signature) or string (legacy signature)
    let variables;
    if (typeof variablesOrEventTitle === 'object' && variablesOrEventTitle !== null && !Array.isArray(variablesOrEventTitle)) {
      // New signature: (fileLocation, variablesObject)
      variables = variablesOrEventTitle;
    } else {
      // Legacy signature: (fileLocation, eventTitle, eventPromotionalPhoto, qrCodeRef, otp)
      variables = {
        eventTitle: variablesOrEventTitle || '',
        eventPromotionalPhoto: eventPromotionalPhoto || '',
        qrcodeData: qrCodeRef || '',
        ticketCode: otp || ''
      };
    }

    return await compileMjmlTemplate(mjmlPath, variables);
  }

export const loadEmailTemplateForMerchant = async (fileLocation, orgName, dashboardUrl) => {
    // Replace .html with .mjml in file path
    const mjmlPath = fileLocation.replace('.html', '.mjml');
    const variables = {
      orgName,
      dashboardUrl
    };
    return await compileMjmlTemplate(mjmlPath, variables);
}

export const loadFeedbackTemplate = async (name, email, subject, message) => {
    const fileLocation = './emailTemplates/feedback_acknowledgement.mjml';
    const variables = {
      name,
      email,
      subject,
      message,
      date: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    };
    return await compileMjmlTemplate(fileLocation, variables);
}

export const loadCareerTemplate = async (name, email, phone, position, experience, availability) => {
    const fileLocation = './emailTemplates/career_acknowledgement.mjml';
    const variables = {
      name,
      email,
      phone: phone || 'Not provided',
      position,
      experience: experience || 'Not provided',
      availability: availability || 'Not specified',
      date: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    };
    return await compileMjmlTemplate(fileLocation, variables);
}

export const loadVerificationCodeTemplate = async (code) => {
    const fileLocation = './emailTemplates/verification_code.mjml';
    const currentYear = new Date().getFullYear();
    const companyName = process.env.COMPANY_TITLE || 'Finnep';
    const contactEmail = process.env.EMAIL_USERNAME || 'info@finnep.fi';

    const variables = {
      verificationCode: code,
      currentYear,
      companyName,
      contactEmail
    };
    return await compileMjmlTemplate(fileLocation, variables);
}

export const getCloudFrontUrl = async (photoLink) =>{
const cloudFrontUrl = photoLink.replace(
    /https?:\/\/[^.]+\.s3\.[^.]+\.amazonaws\.com/,
    process.env.CLOUDFRONT_URL
);
const encodedCloudFrontUrl = encodeURI(cloudFrontUrl);
const policy = {
    Statement: [
        {
        Resource: encodedCloudFrontUrl,
        Condition: {
            DateLessThan: {
            "AWS:EpochTime": Math.floor(Date.now() / 1000) + (30*24 * 60 * 60) // time in 30 days
            },
        },
        },
    ],
};
const policyString = JSON.stringify(policy);
// Create signed CloudFront URL
const signedUrl = getSignedUrl({
    keyPairId,
    privateKey,
    policy:policyString
});
return signedUrl
}

export const createCode = async (codeLength=10) =>{

    let otp = '';
    for (let i = 0; i < codeLength; i++) {
        otp += CHARACTERS.charAt(crypto.randomInt(0, CHARACTERS.length));
    }
    return otp
}
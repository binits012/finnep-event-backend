import { generateICS,generateQRCode, loadEmailTemplate } from './common.js'
import * as Ticket from '../model/ticket.js'
import {error} from '../model/logger.js'
import dotenv from 'dotenv'
dotenv.config()
import { dirname } from 'path'
const __dirname = dirname(import.meta.url).slice(7)

export const createEmailPayload = async (event,ticketInfo, ticketFor, otp) =>{
    try{
        const ticketId = ticketInfo.id
        const icsData = await generateICS(event, ticketId) 
        const qrData = await generateQRCode(ticketId)
        const updateObj = {
            qrCode:qrData,
            ics:icsData
        }
        await Ticket.updateTicketById(ticketId,updateObj) 
        // now we have email templates on the event itself, let's check whether it is configured or not and based on that we do what is needed to do 
        const emailTemplate = event?.otherInfo?.emailTemplate
        let loadedData = null
        if(emailTemplate ){
            loadedData = emailTemplate.replace('$eventTitle',event.eventTitle)
            .replace('$eventPromotionalPhoto',event.eventPromotionalPhoto)
            .replace('$qrcodeData', 'cid:qrcode@ticket') 
            .replace('$ticketCode',otp)
        }else{
            const fileLocation = __dirname.replace('util', '') +'/emailTemplates/ticket_template.html'
            loadedData = await  loadEmailTemplate(fileLocation, event.eventTitle, event.eventPromotionPhoto, 'cid:qrcode@ticket', otp)
        }
        const qrBase64 = qrData.split(',')[1]; // Remove the data URI prefix
        const message = {
            from:process.env.EMAIL_USERNAME,
            to:ticketFor,
            subject:event.eventTitle,
            html:loadedData.toString(),
            attachDataUrls:true, 
            icalEvent: {
                filename: 'event-ticket.ics',
                method: 'request',
                content: icsData
            },
            attachments: [
                {
                    filename: 'ticket-qrcode.png',
                    content: qrBase64,
                    encoding: 'base64',
                }
            ]
        }
        return message
         
    }catch(err) {
        error('error creating ticket email payload %s', err)
        return err
    }
} 
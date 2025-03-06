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
        const fileLocation = __dirname.replace('util', '') +'/emailTemplates/ticket_template.html'
        const loadedData = await  loadEmailTemplate(fileLocation, event.eventTitle, event.eventPromotionPhoto, qrData, otp)
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
            }
        }
        return message
         
    }catch(err) {
        error('error creating ticket email payload %s', err)
        return err
    }
} 
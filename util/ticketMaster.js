'use strict'
require('dotenv').config()
const logger = require('../model/logger')
const Ticket = require('../model/ticket')
const { generateICS,generateQRCode, loadEmailTemplate } = require('./common')

const createEmailPayload = async (event,ticketInfo, ticketFor, type) =>{
    try{
        const ticketId = ticketInfo.id
        const icsData = await generateICS(event, ticketId) 
        const qrData = await generateQRCode(ticketId)
        const updateObj = {
            qrCode:qrData,
            ics:icsData,
            type:type
        }
        await Ticket.updateTicketById(ticketId,updateObj) 
        const fileLocation = __dirname.replace('util', '') +'/emailTemplates/ticket_template.html'
        const loadedData = await  loadEmailTemplate(fileLocation, event.eventTitle, event.eventPromotionPhoto, qrData)
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
        logger.log('error', err)
        return err
    }
}

module.exports ={
    createEmailPayload
}

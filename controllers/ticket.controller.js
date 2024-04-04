'use strict'
const jwtToken = require('../util/jwtToken')
const consts = require('../const')
const appText = require('../applicationTexts.js')
const logger = require('../model/logger')
const Event = require('../model/event')
const Ticket = require('../model/ticket')
const hash = require('../util/createHash')  
const sendMail = require('../util/sendMail')
const ticketMaster = require('../util/ticketMaster')
const busboyFileUpload = require('../util/busboyFileUpload')


const createSingleTicket = async(req,res,next) =>{
    const token = req.headers.authorization
    const ticketFor = req.body.ticketFor
    const eventId = req.body.event
    const type = req.body.type

    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
            const event = await Event.getEventById(eventId).catch(err=>{
                logger.log('error', err.stack) 
                if(!res.headersSent){
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        message: 'Sorry, single ticket creation failed.', error: appText.RESOURCE_NOT_FOUND
                    })
                }   
            }) 
            let ticketId = null 
            if(!res.headersSent){
                //check whether the given email is already in the system or not
                try{
                    const emailCrypto = await hash.getCryptoByEmail(ticketFor)
                    let emailHash = null
                    if(emailCrypto.length == 0){
                        //new email which is not yet in the system
                        let tempEmailHash = await hash.createHashData(ticketFor, 'email')
                        emailHash = tempEmailHash._id
                    }else{
                        emailHash = emailCrypto[0]._id
                    }
                    if(type === 'undefined' || type === '' || type === null) type = 'normal' 
                    // create a ticket
                    const ticket = await Ticket.createTicket(null, emailHash,event).catch(err=>{
                        logger.log('error',err)
                        throw err
                    })
                    ticketId = ticket.id
                    const emailPayload = await ticketMaster.createEmailPayload(event, ticket, ticketFor)
                    await new Promise(resolve => setTimeout(resolve, 100)) //100 mili second intentional delay
                    await sendMail.forward(emailPayload).then(async data=>{
                        //all good let's update the ticket model once more
                        console.log("email sent data \n", data)
                        const ticketData = await Ticket.updateTicketById(ticket.id, {isSend:true} )
                        return res.status(consts.HTTP_STATUS_CREATED).json({ data:ticketData })
                    }).catch(err=>{
                        //let's not dump the hard work, we will try to send the mail in a while later
                        logger.log('error',err)
                    })
                }catch(err){ 
                    //no point keeping the ticket let's roll back 
                    if(ticketId) await Ticket.deleteTicketById(ticketId).catch(err=>{ 
                        //let it fail, at this point we are really not intrested with it, we did what we could
                        logger.log('error',err)
                    })
                    if(!res.headersSent){
                        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                            message: 'Sorry, ticket creation failed', error: err.stack
                        })
                    }  
                } 
            }   
        }
    })
}

const createMultipleTicket = async(req,res,next) =>{
    const token = req.headers.authorization 
    await jwtToken.verifyJWT(token, async (err, data) => {
        if (err || data === null) { 
            return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
            })
        } else { 
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER ===userRoleFromToken) { 
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            } 
            try{
                await busboyFileUpload.createTicketViaFile(req).then(data =>{
                    if(data){
                        const data = {
                            message:"Request accepted, it will take some time to complete the job. Please keep refreshing the page."
                        }
                        return res.status(consts.HTTP_STATUS_ACCEPTED).json(data)
                    }
                }).catch(err=>{
                    console.log("what's the error")
                    console.log(err.stack)
                    throw err
                }) 

            }catch(err){
                if(!res.headersSent){
                    logger.log('error', err)
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, something went wrong.', error: appText.INTERNAL_SERVER_ERROR
                    })
                }   
            } 
        }
    })
}
module.exports = {
    createSingleTicket,
    createMultipleTicket
}
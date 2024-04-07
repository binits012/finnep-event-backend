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
const fs = require('fs').promises


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
                    const ticket = await Ticket.createTicket(null, emailHash,event,type).catch(err=>{
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
                    logger.log('error',err.stack)
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

const getAllTicketByEventId = async(req,res,next) =>{
     
    const token = req.headers.authorization
    const eventId = req.params.id
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
                        message: 'Sorry, get all tickets by event failed.', error: appText.RESOURCE_NOT_FOUND
                    })
                }   
            }) 

            if(!res.headersSent){
                const ticket = await Ticket.getAllTicketByEventId(event.id).then(async data=>{
                    if(data !== null || data.length >0){
                        //https://mongodb.com/blog/post/6-rules-of-thumb-for-mongodb-schema-design
                        // no denormalization is done on schema therefore populate will show null event id for all the tickets
                        // therefore filter out the db response with given event Id
                         
                        data = data.filter(e=>e.event !=null && e.event.id===eventId)

                        //email is still in encrypted state
                        // decrypt them 
                         
                        data = data.map(async e=>{
                            const email= await  getEmail(e.ticketFor.id)  
                            const data = {
                                id: e.id,
                                ticketFor: email,
                                event:e.event.id, //only event id is relevant here
                                isSend:e.isSend,
                                active: e.active,
                                isRead: e.isRead,
                                type: e.type,
                                createdAt: e.createdAt
                            }
                            
                            return data
                        }) 
                        const tempData = new Array()
                        Promise.all(data).then(el=>{
                            tempData.push(el)
                        }).then(()=>{
                            const flattenedArray = tempData.reduce((acc, curr)=>acc.concat(curr),[])
                            res.status(consts.HTTP_STATUS_OK).json({data:flattenedArray})
                        })
                        
                    }
                    
                }).catch(err=>{
                    console.log(err)
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, get all tickets by event failed.', error: appText.INTERNAL_SERVER_ERROR
                    })
                })
            }

        }
    })
}

const getTicketById = async(req,res,next) =>{
    const token = req.headers.authorization
    const id = req.params.id
    try{
        const ticket = await Ticket.getTicketById(id)
        if(ticket === null){
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                message: 'Sorry, get ticket by id failed.', error: appText.RESOURCE_NOT_FOUND
            })
            throw new Error()
        }
        if(typeof token === 'undefined' || token === null){ 
                const pattern = /(?!^).(?=[^@]+@)/g
                const data = {
                    id: ticket.id,
                    ticketFor: (await getEmail(ticket.ticketFor.id)).replace(pattern,'*'),
                    event:{id:ticket.event.id, eventName:ticket.event.eventTitle, eventDate:ticket.event.eventDate.toISOString().replace('T',' ').replace('.000Z',''), venue:ticket.event.eventLocationAddress},
                    isSend: ticket.isSend,
                    active: ticket.active,
                    isRead: ticket.isRead,
                    type: ticket.type,
                    createdAt: ticket.createdAt  
                }
                const page = (await fs.readFile(__dirname.replace('controllers','')+'/staticPages/ticketInfo.html','utf8')) .replace('$eventTitle',data.event.eventName)
                .replace('$ticketId', data.id).replace('$ticketFor',data.ticketFor).replace('$eventDate',data.event.eventDate).replace('$eventLocation',data.event.venue)
                .replace('$createdAt', data.createdAt)
                res.type('text/html')
                
                res.status(consts.HTTP_STATUS_OK).send(page)   
        }else{
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
                    if(!res.headersSent){  
                        const data = {
                            id: ticket.id,
                            ticketFor: await getEmail(ticket.ticketFor.id),
                            event:{id:ticket.event.id, eventName:ticket.event.eventTitle, eventDate:ticket.event.eventDate},
                            isSend: ticket.isSend,
                            active: ticket.active,
                            isRead: ticket.isRead,
                            type: ticket.type,
                            createdAt: ticket.createdAt
                        }  
                        res.status(consts.HTTP_STATUS_OK).json({data:data})   
                    }
        
                }
            })
        }
        
    }catch(err){
        logger.log('error',err.stack)
        if(!res.headersSent){
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                message: 'Sorry, get ticket by id failed.', error: appText.INTERNAL_SERVER_ERROR
            })
        }
    }
    
    
    
}
//private
const getEmail = async(id)=>{
    const emailObj =  await hash.readHash(id)  
    return emailObj.data
}
module.exports = {
    createSingleTicket,
    createMultipleTicket,
    getAllTicketByEventId,
    getTicketById
}
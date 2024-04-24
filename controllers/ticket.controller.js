 
import * as jwtToken from '../util/jwtToken.js'
import * as consts from '../const.js'
import * as appText from '../applicationTexts.js'
import {error} from '../model/logger.js'
import * as Event from '../model/event.js'
import * as Ticket from '../model/ticket.js'
import * as hash from '../util/createHash.js'  
import * as sendMail from '../util/sendMail.js'
import * as ticketMaster from '../util/ticketMaster.js'
import * as busboyFileUpload from '../util/busboyFileUpload.js'
import * as  fs from 'fs/promises'

import { dirname } from 'path'
const __dirname = dirname(import.meta.url)
console.log(__dirname)

export const createSingleTicket = async(req,res,next) =>{
    const token = req.headers.authorization
    const ticketFor = req.body.ticketFor
    const eventId = req.body.event
    let typeOfTicket = req.body.type

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
                error('error', err.stack) 
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
                    if(typeOfTicket === 'undefined' || typeOfTicket === '' || typeOfTicket === null) typeOfTicket = 'normal' 
                    // create a ticket
                    const ticket = await Ticket.createTicket(null, emailHash,event,typeOfTicket).catch(err=>{
                        error('error creating ticket',err.stack)
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
                        error('error forwarding ticket %s',err)
                        throw err
                    })
                }catch(err){ 
                    //no point keeping the ticket let's roll back 
                    error( "created %s", ticketId + " but due to error we might throw it out. %s", err)
                    if(ticketId) await Ticket.deleteTicketById(ticketId).catch(err=>{ 
                        //let it fail, at this point we are really not intrested with it, we did what we could
                        error('error deleting ticket id %s due to error %s', ticketId, err.stack)
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

export const createMultipleTicket = async(req,res,next) =>{
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
                    error('error',err.stack)
                    throw err
                }) 

            }catch(err){
                if(!res.headersSent){
                    error('error', err)
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, something went wrong.', error: appText.INTERNAL_SERVER_ERROR
                    })
                }   
            } 
        }
    })
}

export const getAllTicketByEventId = async(req,res,next) =>{
     
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
                error('error', err.stack) 
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
                        }).catch(err=>{
                            error('error',err)
                            throw err
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

export const getTicketById = async(req,res,next) =>{
    const token = req.headers.authorization
    const id = req.params.id
    try{
        const ticket = await Ticket.getTicketById(id)
        if(ticket === null){
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                message: 'Sorry, get ticket by id failed.', error: appText.RESOURCE_NOT_FOUND
            }) 
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
                const page = (await fs.readFile(__dirname.replace('controllers','')+'/staticPages/ticketInfo.html','utf8')) .replace('$eventTitle',data.event.eventTitle)
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
                            readBy: typeof ticket.readBy !== 'undefined' ? ticket.readBy.name : null,
                            type: ticket.type,
                            createdAt: ticket.createdAt
                        }  
                        res.status(consts.HTTP_STATUS_OK).json({data:data})   
                    }
        
                }
            })
        }
        
    }catch(err){
        error('error',err.stack)
        if(!res.headersSent){
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                message: 'Sorry, get ticket by id failed.', error: appText.INTERNAL_SERVER_ERROR
            })
        }
    }
}

export const ticketCheckIn = async(req, res, next) =>{
    const token = req.headers.authorization
    const id = req.params.id
    const isRead = req.body.isRead
    const ticketFor = req.body.ticketFor
    const eventId = req.body.event
    try{

        const ticket = await Ticket.getTicketById(id)
        if(ticket === null){
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                message: 'Sorry, get ticket by id failed.', error: appText.RESOURCE_NOT_FOUND
            }) 
        }

        //check ticket info
        const emailCrypto = await hash.getCryptoByEmail(ticketFor)
        console.log(emailCrypto[0]._id.toString(), '=', ticket.ticketFor.id, ticket.event.id,'=', eventId )
        if(emailCrypto[0]._id.toString() === ticket.ticketFor.id && ticket.event.id === eventId){

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
                        const userId = data.id  
                        const obj = {
                            isRead: isRead,
                            readBy:userId
                        }
                        await Ticket.updateTicketById(id, obj).then(data=>{
                            logger.info('ticket %s',id + " is now updated by %s" + userId)
                            res.status(consts.HTTP_STATUS_OK).json({data:data}) 
                        }) 
                          
                    }
        
                }
            })
        }else{
            if(!res.headersSent){
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, ticket not found. Could be ticket is not for this event.', error: appText.RESOURCE_NOT_FOUND
                })
            }
        }
        
    }catch(err){
        error('error',err.stack)
        if(!res.headersSent){
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                message: 'Sorry, update ticket by id failed.', error: appText.INTERNAL_SERVER_ERROR
            })
        }
    }
}

export const getAllTickets = async (req, res,next) =>{ 
         
    return await Ticket.getAllTickets()
    
}

//private
const getEmail = async(id)=>{
    const emailObj =  await hash.readHash(id)  
    return emailObj.data
} 
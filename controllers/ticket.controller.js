import * as jwtToken from '../util/jwtToken.js'
import * as consts from '../const.js'
import * as appText from '../applicationTexts.js'
import {error, info} from '../model/logger.js'
import * as Event from '../model/event.js'
import * as Ticket from '../model/ticket.js'
import * as hash from '../util/createHash.js'
import * as sendMail from '../util/sendMail.js'
import * as ticketMaster from '../util/ticketMaster.js'
import * as busboyFileUpload from '../util/busboyFileUpload.js'
import * as  fs from 'fs/promises'
import * as OrderTicket from '../model/orderTicket.js'
import crypto from 'crypto'
import { dirname } from 'path'
import {manipulatePhoneNumber, generateQRCode} from '../util/common.js'
const __dirname = dirname(import.meta.url).slice(7)

const childQrPattern = /^([a-fA-F0-9]{24})#([1-9]\d*)$/

const parseChildQrValue = (value = '') => {
    const match = decodeURIComponent(value).match(childQrPattern)
    if (!match) return null
    return {
        parentTicketId: match[1],
        childIndex: Number(match[2]),
        childQrCodeValue: decodeURIComponent(value)
    }
}

const mapTicketInfoForScanner = (ticketInfo) => {
    if (!ticketInfo || typeof ticketInfo !== 'object') return {}
    if (ticketInfo instanceof Map) {
        return Object.fromEntries(ticketInfo.entries())
    }
    return ticketInfo
}

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
                error( err.stack)
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
                    //get the ticketInfo eg price and rest of the stuff

                    const eventPrice = event.ticketInfo.filter(e => typeOfTicket === e.id).map(e => e.price)
                    const tempTicketOrderObj = {
                        eventName: event.eventTitle,
                        eventId: eventId,
                        price: eventPrice[0],
                        quantity: 1,
                        ticketType: typeOfTicket,
                        totalPrice: eventPrice[0],
                        email: emailHash
                    }
                    //create order
                    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456789';
                    let otp = '';
                    for (let i = 0; i < 10; i++) {
                        otp += characters.charAt(crypto.randomInt(0, characters.length));
                    }
                    const ticketOrder = await createTicketOrder(otp, tempTicketOrderObj)
                    // create a ticket
                    const ticket = await Ticket.createTicket(null, emailHash,event,typeOfTicket,ticketOrder.ticketInfo, otp).catch(err=>{
                        error('error creating ticket',err.stack)
                        throw err
                    })
                    ticketId = ticket.id
                    // Extract locale from request (default to en-US if not available)
                    const locale = req?.query?.locale || req?.headers?.['accept-language'] ?
                        (await import('../util/common.js')).extractLocaleFromRequest(req) : 'en-US';
                    const emailPayload = await ticketMaster.createEmailPayload(event, ticket, ticketFor, otp, locale)

                    await new Promise(resolve => setTimeout(resolve, 100)) //100 mili second intentional delay
                    await OrderTicket.updateOrderTicketById(ticketOrder.id, {
                                        status: 'completed',
                                        attempts:  1,
                                        updatedAt: Date.now(),
                                        ticket: ticketId
                                    })
                    await sendMail.forward(emailPayload).then(async data=>{
                        //all good let's update the ticket model once more
                        const ticketData = await Ticket.updateTicketById(ticket.id, {isSend:true} )
                        return res.status(consts.HTTP_STATUS_CREATED).json({ data:ticketData })
                    }).catch(err=>{
                        //let's not dump the hard work, we will try to send the mail in a while later
                        error('error forwarding ticket %s',err)
                        throw err
                    })
                }catch(err){
                    //no point keeping the ticket let's roll back
                    error( "created %s", ticketId + " but due to error we might throw it out.", err)
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
    const pageSize = 1000

    // page is 1-based, default to 1
    const rawPage = parseInt(req.query.page, 10)
    const page = Number.isNaN(rawPage) || rawPage <= 0 ? 1 : rawPage
    const skip = (page - 1) * pageSize

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
                try{
                    const [tickets, total] = await Promise.all([
                        Ticket.getAllTicketByEventId(event.id, { skip, limit: pageSize }),
                        Ticket.countTicketsByEventId(event.id)
                    ])

                    if(!Array.isArray(tickets) || tickets.length === 0){
                        return res.status(consts.HTTP_STATUS_OK).json({
                            data: [],
                            pagination: {
                                total: 0,
                                page,
                                pageSize,
                                totalPages: 0
                            }
                        })
                    }

                    //https://mongodb.com/blog/post/6-rules-of-thumb-for-mongodb-schema-design
                    // no denormalization is done on schema therefore populate will show null event id for all the tickets
                    // therefore filter out the db response with given event Id

                    let data = tickets.filter(e=>e.event !=null && e.event.id===eventId)

                    //email is still in encrypted state
                    // decrypt them
                    const mappedTickets = await Promise.all(
                        data.map(async e=>{
                            const email= await  getEmail(e?.ticketFor?.id)

                            let ticketType = e?.event?.ticketInfo.filter(el =>e.type === el.name)?.map(el=>el.name)

                            if(ticketType.length == 0) ticketType = e?.event?.ticketInfo.filter(el =>e.type === el.id)?.map(el=>el.name)
                            const ticketData = {
                                id: e.id,
                                ticketFor: email,
                                event:e.event.id, //only event id is relevant here
                                isSend:e.isSend,
                                active: e.active,
                                isRead: e.isRead,
                                type: ticketType.length == 0 ? 'normal' : ticketType[0],
                                ticketCode:e.otp,
                                quantity:e?.ticketInfo?.get("quantity"),
                                price:e?.ticketInfo?.get("price"),
                                totalPrice: e?.ticketInfo?.get("totalPrice"),
                                createdAt: e.createdAt
                            }
                            return ticketData
                        })
                    )

                    const totalPages = Math.ceil(total / pageSize)

                    res.status(consts.HTTP_STATUS_OK).json({
                        data: mappedTickets,
                        pagination: {
                            total,
                            page,
                            pageSize,
                            totalPages
                        }
                    })
                }catch(err){
                    error('error',err.stack)
                    if(!res.headersSent){
                        return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                            message: 'Sorry, get all tickets by event failed.', error: appText.INTERNAL_SERVER_ERROR
                        })
                    }
                }
            }

        }
    })
}

export const getTicketById = async(req,res,next) =>{
    const token = req.headers.authorization
    const id = req.params.id
    try{
        const ticket = await Ticket.getTicketById(id)

        const ticketTypeId = ticket.ticketInfo.get("ticketType")
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
                    createdAt: ticket.createdAt,
                    ticketCode: ticket?.otp,
                    ticketInfo:{
                        quantity:ticket.ticketInfo.get("quantity"),
                        ticketType:ticket.event.ticketInfo.filter(e=>e.id===ticketTypeId).map(e=>e.name)[0],
                        totalPrice:ticket.ticketInfo.get("totalPrice")
                    }
                }
                const page = (await fs.readFile(__dirname.replace('controllers','')+'/staticPages/ticketInfo.html','utf8')) .replace('$eventTitle',data.event.eventName)
                .replace('$ticketId', data.id).replace('$ticketFor',data.ticketFor).replace('$eventDate',data.event.eventDate).replace('$eventLocation',data.event.venue)
                .replace('$createdAt', data.createdAt)
                .replace('$ticketType', data.ticketInfo.ticketType)
                .replace('$quantity', data.ticketInfo.quantity)
                .replace('$totalPrice', data.ticketInfo.totalPrice)
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
                            event:{id:ticket.event.id, eventName:ticket.event.eventTitle, eventDate:ticket.event.eventDate, venue:ticket.event.eventLocationAddress},
                            isSend: ticket.isSend,
                            active: ticket.active,
                            isRead: ticket.isRead,
                            readBy: typeof ticket.readBy !== 'undefined' ? ticket.readBy.name : null,
                            type: ticket.type,
                            createdAt: ticket.createdAt,
                            ticketCode: ticket?.otp,
                            ticketInfo:{
                                quantity:ticket.ticketInfo.get("quantity"),
                                ticketType:ticket.event.ticketInfo.filter(e=>e.id===ticketTypeId).map(e=>e.name)[0],
                                totalPrice:ticket.ticketInfo.get("totalPrice")
                            }
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

        const manipulatedNumber = await manipulatePhoneNumber(ticketFor)
        const dataType = manipulatedNumber === null ? 'email' : 'phone'
        let emailCrypto = await hash.getCryptoBySearchIndex(ticketFor, dataType)
        if(emailCrypto.length == 0){
            emailCrypto = await hash.getCryptoByEmail(ticketFor)
        }
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
                            info('ticket %s',id + " is now updated by %s" + userId)
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

export const getTicketByChildQrValue = async (req, res, next) => {
    const token = req.headers.authorization
    const rawQrValue = req.params.qrValue
    const parsed = parseChildQrValue(rawQrValue)
    if (!parsed) {
        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid child QR value format', error: appText.INVALID_ID
        })
    }

    try {
        const childTicket = await Ticket.getChildTicketQRByValue(parsed.childQrCodeValue)
        const parentFallback = childTicket?.parentTicketId
            ? null
            : await Ticket.getTicketById(parsed.parentTicketId, false)
        const parentFromFallback = parentFallback
            && mapTicketInfoForScanner(parentFallback.ticketInfo)?.childQRCodes
            && Array.isArray(mapTicketInfoForScanner(parentFallback.ticketInfo).childQRCodes)
            ? mapTicketInfoForScanner(parentFallback.ticketInfo).childQRCodes.find(
                (item) => Number(item?.childIndex) === parsed.childIndex && item?.value === parsed.childQrCodeValue
            )
            : null
        if ((!childTicket || !childTicket.parentTicketId) && !parentFromFallback) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                message: 'Sorry, child ticket not found.', error: appText.RESOURCE_NOT_FOUND
            })
        }

        await jwtToken.verifyJWT(token, async (err, data) => {
            if (err || data === null) {
                return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                    message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
                })
            }

            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER === userRoleFromToken) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }

            const parent = childTicket?.parentTicketId || parentFallback
            const ticketInfo = mapTicketInfoForScanner(parent.ticketInfo)
            const quantity = parseInt(ticketInfo?.quantity || '1', 10) || 1
            const childCheckins = ticketInfo?.childCheckins && typeof ticketInfo.childCheckins === 'object'
                ? ticketInfo.childCheckins
                : {}
            const fallbackStatus = childCheckins[parsed.childQrCodeValue] || {}
            const isRead = childTicket ? childTicket.isRead : !!fallbackStatus.is_read
            const readAt = childTicket ? childTicket.readAt : (fallbackStatus.read_at || null)
            const checkedInQuantity = isRead ? 1 : 0
            const remainingQuantity = isRead ? 0 : 1
            const childQrImage = await generateQRCode(parsed.childQrCodeValue)

            return res.status(consts.HTTP_STATUS_OK).json({
                data: {
                    id: String(parent._id),
                    child_ticket_id: childTicket?._id ? String(childTicket._id) : null,
                    child_qr_code_value: parsed.childQrCodeValue,
                    child_index: parsed.childIndex,
                    is_child_qr: true,
                    qr_code: childQrImage,
                    event_id: String(parent.event?._id || parent.event || ''),
                    event_name: parent.event?.eventTitle || '',
                    event_date: parent.event?.eventDate || null,
                    event_timezone: parent.event?.eventTimezone || null,
                    event_status: parent.event?.status || null,
                    event_active: parent.event?.active ?? true,
                    ticket_info: {
                        ...ticketInfo,
                        quantity: '1',
                        parent_quantity: String(quantity)
                    },
                    type: parent.type || 'normal',
                    active: childTicket ? childTicket.active : parent.active,
                    is_read: isRead,
                    read_by: childTicket?.readBy?.name || null,
                    read_at: readAt,
                    created_at: childTicket?.createdAt || parent.createdAt,
                    checked_in_quantity: checkedInQuantity,
                    remaining_quantity: remainingQuantity
                }
            })
        })
    } catch (err) {
        error('error', err.stack)
        if (!res.headersSent) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                message: 'Sorry, get child ticket by qr failed.', error: appText.INTERNAL_SERVER_ERROR
            })
        }
    }
}

export const childTicketCheckIn = async (req, res, next) => {
    const token = req.headers.authorization
    const rawQrValue = req.params.qrValue
    const parsed = parseChildQrValue(rawQrValue)
    if (!parsed) {
        return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
            message: 'Invalid child QR value format', error: appText.INVALID_ID
        })
    }

    try {
        const childTicket = await Ticket.getChildTicketQRByValue(parsed.childQrCodeValue)
        const parentFallback = childTicket?.parentTicketId
            ? null
            : await Ticket.getTicketById(parsed.parentTicketId, false)
        const parent = childTicket?.parentTicketId || parentFallback
        const ticketInfo = parent ? mapTicketInfoForScanner(parent.ticketInfo) : {}
        const childQRCodes = Array.isArray(ticketInfo?.childQRCodes) ? ticketInfo.childQRCodes : []
        const childEntry = childQRCodes.find(
            (item) => Number(item?.childIndex) === parsed.childIndex && item?.value === parsed.childQrCodeValue
        )
        if ((!childTicket || !childTicket.parentTicketId) && !childEntry) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                message: 'Sorry, child ticket not found.', error: appText.RESOURCE_NOT_FOUND
            })
        }

        const eventIdFromRequest = req.body.eventId || req.body.event
        const parentEventId = String(childTicket?.event?._id || parent?.event?._id || parent?.event || '')
        if (eventIdFromRequest && String(eventIdFromRequest) !== parentEventId) {
            return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                message: 'Sorry, child ticket not found. Could be ticket is not for this event.', error: appText.RESOURCE_NOT_FOUND
            })
        }

        if (childTicket?.isRead) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                message: 'Child ticket already checked in', error: appText.BAD_REQUEST
            })
        }

        const childCheckins = ticketInfo?.childCheckins && typeof ticketInfo.childCheckins === 'object'
            ? { ...ticketInfo.childCheckins }
            : {}
        if (!childTicket && childCheckins[parsed.childQrCodeValue]?.is_read) {
            return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                message: 'Child ticket already checked in', error: appText.BAD_REQUEST
            })
        }

        await jwtToken.verifyJWT(token, async (err, data) => {
            if (err || data === null) {
                return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                    message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
                })
            }
            const userRoleFromToken = data.role
            if (consts.ROLE_MEMBER === userRoleFromToken) {
                return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                    message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                })
            }

            if (childTicket) {
                const updated = await Ticket.updateChildTicketQRByValue(parsed.childQrCodeValue, {
                    isRead: true,
                    readBy: data.id,
                    readAt: new Date()
                })
                return res.status(consts.HTTP_STATUS_OK).json({ data: updated })
            }

            childCheckins[parsed.childQrCodeValue] = {
                is_read: true,
                read_by: data.id,
                read_at: new Date().toISOString()
            }
            const updatedParent = await Ticket.updateTicketById(parent.id, {
                ticketInfo: {
                    ...ticketInfo,
                    childCheckins
                }
            })
            return res.status(consts.HTTP_STATUS_OK).json({ data: updatedParent })
        })
    } catch (err) {
        error('error', err.stack)
        if (!res.headersSent) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                message: 'Sorry, update child ticket check-in failed.', error: appText.INTERNAL_SERVER_ERROR
            })
        }
    }
}

export const getAllTickets = async (req, res,next) =>{

    return await Ticket.getAllTickets()

}

export const searchTicket = async (req, res, next) => {
    const token = req.headers.authorization
    const id = req.params.id
    const { code, phone } = req.query

    try {
        await jwtToken.verifyJWT(token, async (err, data) => {
            if (err || data === null) {
                return res.status(consts.HTTP_STATUS_SERVICE_UNAUTHORIZED).json({
                    message: 'Please, provide valid token', error: appText.TOKEN_NOT_VALID
                })
            } else {
                const userRoleFromToken = data.role
                if (consts.ROLE_MEMBER === userRoleFromToken) {
                    return res.status(consts.HTTP_STATUS_SERVICE_FORBIDDEN).json({
                        message: 'Sorry, You do not have rights', error: appText.INSUFFICENT_ROLE
                    })
                }

                // Validate search parameters
                if (!code && !phone) {
                    return res.status(consts.HTTP_STATUS_BAD_REQUEST).json({
                        message: 'Please provide either ticket code or phone number',
                        error: appText.TICKET_SEARCH_PARAMS_REQUIRED
                    })
                }

                // Create search filter
                let filter = { event: id }
                if (code) {
                    filter.otp = code
                } else if (phone) {
                    // Add '+' back if the phone number starts with numbers (country code)
                    const decodedPhone = phone.match(/^\d/) ? `+${phone}` : phone
                    const phoneHash = await hash.getCryptoBySearchIndex(decodedPhone, 'phone')
                    filter.ticketFor = phoneHash[0]?._id
                }

                // Search for ticket
                const ticket = await Ticket.genericSearch(filter)
                if (!ticket) {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        message: 'Ticket not found',
                        error: appText.RESOURCE_NOT_FOUND
                    })
                }

                // Format response
                const ticketTypeId = ticket.ticketInfo.get("ticketType")
                const response = {
                    id: ticket.id,
                    ticketFor: await getEmail(ticket.ticketFor._id),
                    event: ticket.event._id,
                    isSend: ticket.isSend,
                    active: ticket.active,
                    isRead: ticket.isRead,
                    type: ticket.type,
                    createdAt: ticket.createdAt,
                    ticketCode: ticket.otp,
                    ticketInfo: {
                        quantity: ticket.ticketInfo.get("quantity"),
                        ticketType: ticketTypeId,
                        totalPrice: ticket.ticketInfo.get("totalPrice")
                    },
                    readBy: typeof ticket.readBy !== 'undefined' ? ticket.readBy.name : null,
                }

                return res.status(consts.HTTP_STATUS_OK).json({ data: response })
            }
        })
    } catch(err) {
        error('error', err.stack)
        if (!res.headersSent) {
            return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                message: 'Sorry, ticket search failed',
                error: appText.INTERNAL_SERVER_ERROR
            })
        }
    }
}

//private
const getEmail = async(id)=>{
    const emailObj =  await hash.readHash(id)
    return emailObj.data
}

const createTicketOrder = async (otp, obj) => {
    return await OrderTicket.createOrderTicket(otp, obj)
}
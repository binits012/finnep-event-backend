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
import { canAccessResource, sendRegionalForbidden } from '../util/regionalAccess.js'
import { parseRequestMarketCountryCode } from '../util/platformSettings.js'
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

const getTicketTypeKey = (ticket) => String(ticket?._id || ticket?.id || ticket?.name || '')

const buildTicketTypeLabel = (event, ticketType) => {
    const configuredTickets = Array.isArray(event?.ticketInfo) ? event.ticketInfo : []
    const configuredTicket = configuredTickets.find(ticket => {
        const ticketKey = getTicketTypeKey(ticket)
        return ticketKey === String(ticketType) || ticket?.name === ticketType
    })

    return configuredTicket?.name || ticketType || 'normal'
}

const buildConfiguredTicketSalesRows = (event, salesRows) => {
    const configuredTickets = Array.isArray(event?.ticketInfo) ? event.ticketInfo : []
    const salesByType = new Map(salesRows.map(row => [String(row._id || 'normal'), row]))
    const usedTypes = new Set()

    const rows = configuredTickets.map(ticket => {
        const possibleKeys = [ticket?._id, ticket?.id, ticket?.name].map(value => String(value || '')).filter(Boolean)
        const sales = possibleKeys.map(key => salesByType.get(key)).find(Boolean)
        possibleKeys.forEach(key => usedTypes.add(key))
        if (sales?._id) usedTypes.add(String(sales._id))

        return {
            ticketType: ticket?.name || 'Unnamed ticket',
            configuredQuantity: Number(ticket?.quantity || 0),
            configuredPrice: Number(ticket?.price || 0),
            ticketDocuments: sales?.ticketDocuments || 0,
            quantitySold: sales?.quantitySold || 0,
            revenue: sales?.revenue || 0,
            sentCount: sales?.sentCount || 0,
            activeCount: sales?.activeCount || 0,
            checkedInCount: sales?.checkedInCount || 0,
            firstSoldAt: sales?.firstSoldAt || null,
            latestSoldAt: sales?.latestSoldAt || null
        }
    })

    salesRows.forEach(sales => {
        if (usedTypes.has(String(sales._id || 'normal'))) return
        rows.push({
            ticketType: buildTicketTypeLabel(event, sales._id),
            configuredQuantity: 0,
            configuredPrice: 0,
            ticketDocuments: sales.ticketDocuments || 0,
            quantitySold: sales.quantitySold || 0,
            revenue: sales.revenue || 0,
            sentCount: sales.sentCount || 0,
            activeCount: sales.activeCount || 0,
            checkedInCount: sales.checkedInCount || 0,
            firstSoldAt: sales.firstSoldAt || null,
            latestSoldAt: sales.latestSoldAt || null
        })
    })

    return rows
}

const maskEmail = (email = '') => {
    const [localPart, domain] = String(email).split('@')
    if (!localPart || !domain) return email ? '***' : ''
    const visible = localPart.slice(0, Math.min(2, localPart.length))
    return `${visible}${'*'.repeat(Math.max(3, localPart.length - visible.length))}@${domain}`
}

const getTicketInfoValue = (ticketInfo, key, fallback = '') => {
    if (!ticketInfo) return fallback
    if (ticketInfo instanceof Map) return ticketInfo.get(key) ?? fallback
    return ticketInfo[key] ?? fallback
}

const toDisplayFinalAmount = (value, fallback = 0) => {
    const numberValue = Number(value)
    if (!Number.isFinite(numberValue)) return fallback
    const roundedThree = Math.round(numberValue * 1000) / 1000
    return Math.ceil((roundedThree * 100) - Number.EPSILON) / 100
}

const toTicketNumber = (value, fallback = 0) => {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : fallback
}

const getTicketOwnerEmail = async (ticket) => {
    const ticketForId = ticket?.ticketFor?.id || ticket?.ticketFor?._id || ticket?.ticketFor
    if (!ticketForId) return ''
    return await getEmail(ticketForId)
}

const getTicketTypeLabel = (event, ticket) => {
    const configuredTickets = Array.isArray(event?.ticketInfo) ? event.ticketInfo : []
    const ticketType = ticket?.type || getTicketInfoValue(ticket?.ticketInfo, 'ticketType', 'normal')
    const configuredTicket = configuredTickets.find(item => (
        String(item?._id || item?.id || item?.name || '') === String(ticketType) || item?.name === ticketType
    ))
    return configuredTicket?.name || ticketType || 'normal'
}

const mapTicketSalesRow = async (ticket, event, { includePii = false } = {}) => {
    const email = await getTicketOwnerEmail(ticket)
    const ticketCode = ticket?.otp || ''
    const ticketInfo = ticket?.ticketInfo
    const quantity = toTicketNumber(getTicketInfoValue(ticketInfo, 'quantity', 1), 1)
    const price = toTicketNumber(getTicketInfoValue(ticketInfo, 'price', 0), 0)
    const storedTotalPrice = toTicketNumber(getTicketInfoValue(ticketInfo, 'totalPrice', 0), 0)
    const totalPrice = storedTotalPrice > 0 ? storedTotalPrice : price * quantity

    return {
        id: ticket.id,
        ticketFor: includePii ? email : undefined,
        ticketForMasked: includePii ? undefined : maskEmail(email),
        event: event.id,
        isSend: ticket.isSend,
        active: ticket.active,
        isRead: ticket.isRead,
        readAt: ticket.readAt || null,
        readBy: ticket.readBy?.name || null,
        type: getTicketTypeLabel(event, ticket),
        ticketCode: includePii ? ticketCode : undefined,
        ticketCodeMasked: includePii || !ticketCode ? undefined : `***${String(ticketCode).slice(-4)}`,
        quantity,
        price: toDisplayFinalAmount(price, 0),
        totalPrice: toDisplayFinalAmount(totalPrice, 0),
        paymentProvider: ticket.paymentProvider || '',
        paytrailTransactionId: ticket.paytrailTransactionId || '',
        paytrailStamp: ticket.paytrailStamp || '',
        paytrailSubMerchantId: ticket.paytrailSubMerchantId || '',
        createdAt: ticket.createdAt
    }
}

const escapeCsvValue = (value) => {
    if (value === undefined || value === null) return ''
    const stringValue = value instanceof Date ? value.toISOString() : String(value)
    return /[",\n\r]/.test(stringValue)
        ? `"${stringValue.replace(/"/g, '""')}"`
        : stringValue
}

const toTicketSalesCsv = (rows = []) => {
    const headers = [
        'ticket_id',
        'buyer_email',
        'ticket_code',
        'ticket_type',
        'quantity',
        'price',
        'total_price',
        'sent',
        'active',
        'checked_in',
        'read_at',
        'read_by',
        'payment_provider',
        'paytrail_transaction_id',
        'paytrail_stamp',
        'paytrail_sub_merchant_id',
        'sold_at'
    ]
    const body = rows.map(row => [
        row.id,
        row.ticketFor,
        row.ticketCode,
        row.type,
        row.quantity,
        row.price,
        row.totalPrice,
        row.isSend,
        row.active,
        row.isRead,
        row.readAt,
        row.readBy,
        row.paymentProvider,
        row.paytrailTransactionId,
        row.paytrailStamp,
        row.paytrailSubMerchantId,
        row.createdAt
    ].map(escapeCsvValue).join(','))

    return [headers.join(','), ...body].join('\n')
}

const getTicketSalesFilters = (query = {}, event = null) => {
    const ticketType = String(query.ticketType || '').trim()
    const configuredTicket = ticketType && Array.isArray(event?.ticketInfo)
        ? event.ticketInfo.find(ticket => (
            String(ticket?._id || '') === ticketType ||
            String(ticket?.id || '') === ticketType ||
            ticket?.name === ticketType
        ))
        : null

    return {
        query: query.query,
        status: query.status,
        ticketType,
        ticketTypes: configuredTicket
            ? [configuredTicket._id, configuredTicket.id, configuredTicket.name].map(value => String(value || '')).filter(Boolean)
            : undefined
    }
}

const getTicketSalesPagination = (query = {}) => {
    const rawPage = parseInt(query.page, 10)
    const rawLimit = parseInt(query.limit, 10)
    const page = Number.isNaN(rawPage) || rawPage <= 0 ? 1 : rawPage
    const limit = Number.isNaN(rawLimit) || rawLimit <= 0 ? 50 : Math.min(rawLimit, 100)
    return {
        page,
        pageSize: limit,
        skip: (page - 1) * limit,
        limit
    }
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
                    const emailPayload = await ticketMaster.createEmailPayload(event, ticket, ticketFor, otp, locale, {
                        marketCountryCode: parseRequestMarketCountryCode(req)
                    })

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
                if (!event) {
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        message: 'Sorry, get all tickets by event failed.', error: appText.RESOURCE_NOT_FOUND
                    })
                }
                if (!canAccessResource(data, event)) {
                    return sendRegionalForbidden(res)
                }

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
                                totalPrice: toDisplayFinalAmount(e?.ticketInfo?.get("totalPrice"), 0),
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

export const getTicketSalesSummaryByEventId = async(req,res,next) =>{
    const token = req.headers.authorization
    const eventId = req.params.id

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

            const event = await Event.getEventById(eventId).catch(err => {
                error('error', err.stack)
                if(!res.headersSent){
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        message: 'Sorry, get ticket sales summary failed.', error: appText.RESOURCE_NOT_FOUND
                    })
                }
            })

            if (res.headersSent) return
            if (!event) {
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, get ticket sales summary failed.', error: appText.RESOURCE_NOT_FOUND
                })
            }
            if (!canAccessResource(data, event)) {
                return sendRegionalForbidden(res)
            }

            try {
                const salesRows = await Ticket.getTicketSalesSummaryByEventId(event.id)
                const ticketTypes = buildConfiguredTicketSalesRows(event, salesRows)
                const summary = ticketTypes.reduce((acc, ticket) => {
                    acc.ticketDocuments += ticket.ticketDocuments
                    acc.quantitySold += ticket.quantitySold
                    acc.revenue += ticket.revenue
                    acc.sentCount += ticket.sentCount
                    acc.activeCount += ticket.activeCount
                    acc.checkedInCount += ticket.checkedInCount
                    return acc
                }, {
                    ticketDocuments: 0,
                    quantitySold: 0,
                    revenue: 0,
                    sentCount: 0,
                    activeCount: 0,
                    checkedInCount: 0,
                    occupancy: Number(event.occupancy || 0)
                })

                summary.remainingCapacity = Math.max(0, summary.occupancy - summary.quantitySold)
                summary.occupancyRate = summary.occupancy > 0
                    ? Math.round((summary.quantitySold / summary.occupancy) * 10000) / 100
                    : 0

                return res.status(consts.HTTP_STATUS_OK).json({
                    data: {
                        event: {
                            id: event.id,
                            eventTitle: event.eventTitle,
                            country: event.country,
                            occupancy: event.occupancy
                        },
                        summary,
                        ticketTypes
                    }
                })
            } catch (err) {
                error('error', err.stack)
                if(!res.headersSent){
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, get ticket sales summary failed.', error: appText.INTERNAL_SERVER_ERROR
                    })
                }
            }
        }
    })
}

export const getTicketSalesByEventId = async(req,res,next) =>{
    const token = req.headers.authorization
    const eventId = req.params.id

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

            const event = await Event.getEventById(eventId).catch(err => {
                error('error', err.stack)
                if(!res.headersSent){
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        message: 'Sorry, get ticket sales failed.', error: appText.RESOURCE_NOT_FOUND
                    })
                }
            })

            if (res.headersSent) return
            if (!event) {
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, get ticket sales failed.', error: appText.RESOURCE_NOT_FOUND
                })
            }
            if (!canAccessResource(data, event)) {
                return sendRegionalForbidden(res)
            }

            try {
                const filters = getTicketSalesFilters(req.query, event)
                const pagination = getTicketSalesPagination(req.query)
                const [tickets, total] = await Promise.all([
                    Ticket.getTicketsByEventIdPaginated(event.id, filters, pagination),
                    Ticket.countTicketsByEventIdFiltered(event.id, filters)
                ])
                const mappedTickets = await Promise.all(
                    tickets.map(ticket => mapTicketSalesRow(ticket, event, { includePii: false }))
                )

                return res.status(consts.HTTP_STATUS_OK).json({
                    data: mappedTickets,
                    filters,
                    pagination: {
                        total,
                        page: pagination.page,
                        pageSize: pagination.pageSize,
                        totalPages: Math.ceil(total / pagination.pageSize)
                    }
                })
            } catch (err) {
                error('error', err.stack)
                if(!res.headersSent){
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, get ticket sales failed.', error: appText.INTERNAL_SERVER_ERROR
                    })
                }
            }
        }
    })
}

export const exportTicketSalesByEventId = async(req,res,next) =>{
    const token = req.headers.authorization
    const eventId = req.params.id

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

            const event = await Event.getEventById(eventId).catch(err => {
                error('error', err.stack)
                if(!res.headersSent){
                    return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                        message: 'Sorry, export ticket sales failed.', error: appText.RESOURCE_NOT_FOUND
                    })
                }
            })

            if (res.headersSent) return
            if (!event) {
                return res.status(consts.HTTP_STATUS_RESOURCE_NOT_FOUND).json({
                    message: 'Sorry, export ticket sales failed.', error: appText.RESOURCE_NOT_FOUND
                })
            }
            if (!canAccessResource(data, event)) {
                return sendRegionalForbidden(res)
            }

            try {
                const filters = getTicketSalesFilters(req.query, event)
                const tickets = await Ticket.getTicketsByEventIdForExport(event.id, filters)
                const mappedTickets = await Promise.all(
                    tickets.map(ticket => mapTicketSalesRow(ticket, event, { includePii: true }))
                )
                const csv = toTicketSalesCsv(mappedTickets)
                const filename = `${String(event.eventName || event.eventTitle || event.id).replace(/[^a-z0-9_-]+/gi, '-')}-ticket-sales.csv`

                res.setHeader('Content-Type', 'text/csv; charset=utf-8')
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
                return res.status(consts.HTTP_STATUS_OK).send(csv)
            } catch (err) {
                error('error', err.stack)
                if(!res.headersSent){
                    return res.status(consts.HTTP_STATUS_INTERNAL_SERVER_ERROR).json({
                        message: 'Sorry, export ticket sales failed.', error: appText.INTERNAL_SERVER_ERROR
                    })
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
                        totalPrice:toDisplayFinalAmount(ticket.ticketInfo.get("totalPrice"), 0)
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
                                totalPrice:toDisplayFinalAmount(ticket.ticketInfo.get("totalPrice"), 0)
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
                        totalPrice: toDisplayFinalAmount(ticket.ticketInfo.get("totalPrice"), 0)
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
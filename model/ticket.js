import * as model from '../model/mongoModel.js'
import {error} from '../model/logger.js'

export class Ticket{
    constructor(qrCode, ticketFor, event, type, ticketInfo, otp, merchantId, externalMerchantId) {
        this.qrCode = qrCode
        this.ticketFor = ticketFor,
        this.event = event
        this.type = type
        this.ticketInfo = ticketInfo,
        this.otp = otp
        this.merchant = merchantId
        this.externalMerchantId = externalMerchantId
    }

    async saveToDB(){
        try{
            const ticket = new model.Ticket({
                qrCode: this.qrCode,
                ticketFor: this.ticketFor,
                event: this.event,
                type: this.type,
                ticketInfo:this.ticketInfo,
                otp:this.otp,
                merchant:this.merchant,
                externalMerchantId:this.externalMerchantId
            })
            return await ticket.save()
        }catch(err){
            error('error creating ticket %s', err.stack)
            throw err
        }
    }
}

export const createTicket = async(qrCode, ticketFor, event, type,ticketInfo, otp, merchantId, externalMerchantId) =>{

    const ticket = new Ticket(qrCode, ticketFor, event, type,ticketInfo, otp, merchantId, externalMerchantId)
    return await ticket.saveToDB()
}

export const getTicketById = async(id, populate = true) =>{
    if (populate) {
        return await model.Ticket.findById(id).populate('ticketFor').populate('event').populate('readBy').exec()
    } else {
        return await model.Ticket.findById(id).populate('event').populate('readBy').exec()
    }
}

export const updateTicketById = async(id, obj) =>{
    return await model.Ticket.findOneAndUpdate({_id:id},{$set:obj}, {new:true}).catch(err=>{
        error('error updating ticket %s', err.stack)
    })
}

export const deleteTicketById = async(id) =>{
    return await model.Ticket.findOneAndDelete({_id:id})
}

export const getAllTicketByEventId = async(eventId, options = {}) =>{
    const { skip = 0, limit } = options

    let query = model.Ticket.find({ event: eventId })
        .populate({path:'event', select: 'id ticketInfo'})
        .populate('ticketFor')
        .select('-qrCode -ics')

    if (typeof skip === 'number' && skip > 0) {
        query = query.skip(skip)
    }

    if (typeof limit === 'number' && limit > 0) {
        query = query.limit(limit)
    }

    return await query.exec()
}

export const countTicketsByEventId = async(eventId) =>{
    return await model.Ticket.countDocuments({ event: eventId }).exec()
}

export const getAllTickets = async() =>{
    return await model.Ticket.find().select('-qrCode -ics').lean().exec()
}

export const genericSearch = async (filter) =>{
    return await model.Ticket.findOne(filter).select('-qrCode -ics').populate('readBy').exec()
}

export const getTicketsByEmailCryptoId = async (emailCryptoId) => {
    return await model.Ticket.find({ ticketFor: emailCryptoId })
        .select('-qrCode -ics')
        .exec()
}

export const upsertChildTicketQR = async (payload) => {
    const {
        parentTicketId,
        childIndex,
        childQrCodeValue,
        event,
        merchant,
        externalMerchantId
    } = payload

    return await model.ChildTicketQR.findOneAndUpdate(
        { parentTicketId, childIndex },
        {
            $set: {
                childQrCodeValue,
                event,
                merchant,
                externalMerchantId,
                active: true
            }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    ).exec()
}

export const getChildTicketQRByValue = async (childQrCodeValue) => {
    return await model.ChildTicketQR.findOne({ childQrCodeValue })
        .populate('parentTicketId')
        .populate('event')
        .populate('readBy')
        .exec()
}

export const updateChildTicketQRByValue = async (childQrCodeValue, obj) => {
    return await model.ChildTicketQR.findOneAndUpdate(
        { childQrCodeValue },
        { $set: obj },
        { new: true }
    ).populate('parentTicketId').populate('event').populate('readBy').exec()
}

export const getChildTicketQRsByParentTicketId = async (parentTicketId) => {
    return await model.ChildTicketQR.find({ parentTicketId, active: true })
        .sort({ childIndex: 1 })
        .select('-qrCode')
        .lean()
        .exec()
}
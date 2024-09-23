import * as model from '../model/mongoModel.js'
import {error} from '../model/logger.js'

export class Ticket{
    constructor(qrCode, ticketFor, event, type, ticketInfo) {
        this.qrCode = qrCode
        this.ticketFor = ticketFor,
        this.event = event
        this.type = type
        this.ticketInfo = ticketInfo
    }

    async saveToDB(){
        try{
            const ticket = new model.Ticket({
                qrCode: this.qrCode,
                ticketFor: this.ticketFor,
                event: this.event,
                type: this.type,
                ticketInfo:this.ticketInfo
            })
            return await ticket.save()
        }catch(err){
            error('error creating ticket %s', err.stack)
            throw err
        }
    }
}

export const createTicket = async(qrCode, ticketFor, event, type,ticketInfo) =>{
          
    const ticket = new Ticket(qrCode, ticketFor, event, type,ticketInfo)
    return await ticket.saveToDB()
}

export const getTicketById = async(id) =>{
    return await model.Ticket.findById({_id:id}).populate('ticketFor').populate('event').populate('readBy').exec()
}

export const updateTicketById = async(id, obj) =>{ 
    return await model.Ticket.findOneAndUpdate({_id:id},{$set:obj}, {new:true}).catch(err=>{
        error('error updating ticket %s', err.stack)
    })
}

export const deleteTicketById = async(id) =>{
    return await model.Ticket.findOneAndDelete({_id:id})
}

export const getAllTicketByEventId = async(eventId) =>{  
    return await model.Ticket.find().populate({path:'event', select: 'id', match:{_id:eventId}}).populate('ticketFor').select('-qrCode -ics').exec()
}

export const getAllTickets = async() =>{
    return await model.Ticket.find().select('-qrCode -ics').exec()
}
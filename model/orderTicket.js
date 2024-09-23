import * as model from '../model/mongoModel.js'
import {error} from '../model/logger.js'

export class OrderTicket {
    constructor( otp, ticketInfo ){
        this.otp = otp
        this.ticketInfo = ticketInfo
    }

    async saveToDB(){
        try{
            const orderTicket = new model.OrderTicket({
                otp:this.otp,
                ticketInfo:this.ticketInfo
            })
            return await orderTicket.save()
        }catch(err){
            error(err)
            throw err
        }
    }
} 

export const createOrderTicket = async (otp, ticketInfo) => {
    const orderTicket = new OrderTicket (otp, ticketInfo)
    return await orderTicket.saveToDB()
}

export const getOrderTicketById = async (id) =>{
    return await model.OrderTicket.findById({_id:id}).exec()
}

export const updateOrderTicketById = async (id, obj) =>{
    return await model.OrderTicket.findByIdAndUpdate(id,{$set:obj},{new:true})
}
import {error} from '../model/logger.js'
import * as Payment from '../model/payment.js'

export const checkoutSuccess = async (event,metadata) =>{
    const ticketOrderId = metadata.ticketOrderId
    const eventId = metadata.eventId
    try{
        const paymentJson = {
            payment:event
        }
        await Payment.createPayment(paymentJson,eventId,ticketOrderId)
    }catch(err){
        error(err)
        throw err
    }
}
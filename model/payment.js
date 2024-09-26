import * as model from '../model/mongoModel.js'
import { error} from './logger.js'


export class Payment {
  constructor(paymentInfo, event, ticket) {
    this.paymentInfo = paymentInfo;
    this.event = event;
    this.ticket = ticket;
  }

  async  saveToDB() {
    try {
      const payment = new model.Payment({
        paymentInfo: this.paymentInfo,
        event: this.event,
        ticket: this.ticket,
      });
      return await payment.save();
    } catch (err) {
      error('Error saving payment:', err);
      throw err; // Re-throw the error for further handling
    }
  }
}

export const createPayment = async(paymentInfo, event, ticket) => {
    try {
       
      const payment = new Payment( paymentInfo, event, ticket );
      return await payment.saveToDB();
    } catch (err) {
      error(  'Error creating payment:', err);
      throw err; // Re-throw the error for further handling
    }
}

export const getPayments = async () =>{
    return await model.Payment.find().exec()
}

export const getPaymentsByEvent = async(eventId) =>{
    return await model.Payment.find({event:eventId})
}
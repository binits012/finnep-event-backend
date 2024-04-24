import  mongoose from 'mongoose'
import  '../model/dbConnect.js'
const ticketReportSchema = new mongoose.Schema({}, { strict: false })
export const TicketReport = mongoose.model('TicketReport', ticketReportSchema)
export const getAllTicketReport = async() =>{
    console.log('this is called')
    try{
        return await  TicketReport.find().exec()
    } catch(err){
        console.log(err)
        throw err
    }
    
}
 
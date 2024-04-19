const mongoose = require('mongoose')
const ticketReportSchema = new mongoose.Schema({}, { strict: false })
const TicketReport = mongoose.model('TicketReport', ticketReportSchema)
const getAllTicketReport = async() =>{
     
    return await  TicketReport.find().exec()
}
module.exports = { 
    TicketReport,
    getAllTicketReport
}
const mongoose = require('mongoose')
const ticketReportSchema = new mongoose.Schema({}, { strict: false })
const TicketReport = mongoose.model('TicketReport', ticketReportSchema)
 
module.exports = { 
    TicketReport
}
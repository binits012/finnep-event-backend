const Ticket = require('../model/ticket')
const {ObjectId} = require('mongodb')
require('../model/dbConnect')
const Crypto = require('../model/crypto')
const Event = require('../model/event') 
const ticketMaster = require('../util/ticketMaster')
const createTicket = async() =>{

    const crypto = await Crypto.readCryptoById('660c1905106a798d33cfe58f')
    const event = await Event.getEventById('66099df581fd6537fc5a0aba')
     
    const ticket = await Ticket.createTicket(null,  crypto._id,  event._id)
    const obj = {
        readyBy:'65f52f5e8f36b0d6abfad1e9',
        readAt: Date.now()
    }
    await Ticket.updateTicketById(ticket._id, obj).catch(err=>{
        console.log(err)
    })
}

const readTicketById = async(id) =>{
    return await Ticket.getTicketById(id).then(data=>{
        console.log(data)
    })
}

const getCryptoByEmail = async(email) =>{
    await Crypto.getCryptoByEmail(email).then(data=>{
        console.log(data)
    })
}

const ticketMasterCreate = async(eventId, ticketId) =>{
    const event = await Event.getEventById(eventId)
    const ticket = await Ticket.getTicketById(ticketId)
    const tm = await ticketMaster.createTicket(event, ticket,"abc@bcd")
    console.log(tm)
}

const getAllTicketByEventId = async(eventId) =>{
    const ticket = await Ticket.getAllTicketByEventId(eventId)
    console.log(ticket)
}
//getCryptoByEmail('binits09@gmail.com')
//readTicketById('660d9536dd2faa2fe7ac675d')
//createTicket()
//ticketMasterCreate('66099df581fd6537fc5a0aba','660dae4f5ae091c27074ef5d')
getAllTicketByEventId('65fffacbec8fca063dc1ff08')
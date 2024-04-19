(function(){

    const model = require('./mongoModel')
    const logger = require('./logger')

    const Ticket = (function(){
        function Ticket(qrCode, ticketFor, event, type ){
            this.qrCode = qrCode
            this.ticketFor = ticketFor,
            this.event = event  
            this.type = type

        }

        Ticket.prototype.saveToDB = function(){

            const ticket = new model.Ticket({
                qrCode:this.qrCode, 
                ticketFor:this.ticketFor, 
                event:this.event,
                type:this.type
            }) 
            return  ticket.save()
        }

        return Ticket

    })()

    const createTicket = async(qrCode, ticketFor, event, type) =>{
          
        const ticket = new Ticket(qrCode, ticketFor, event, type)
        return await ticket.saveToDB()
    }

    const getTicketById = async(id) =>{
        return await model.Ticket.findById({_id:id}).populate('ticketFor').populate('event').populate('readBy').exec()
    }

    const updateTicketById = async(id, obj) =>{ 
        return await model.Ticket.findOneAndUpdate({_id:id},{$set:obj}, {new:true}).catch(err=>{
            logger.log('error', err.stack)
        })
    }

    const deleteTicketById = async(id) =>{
        return await model.Ticket.findOneAndDelete({_id:id})
    }

    const getAllTicketByEventId = async(eventId) =>{  
        return await model.Ticket.find().populate({path:'event', select: 'id', match:{_id:eventId}}).populate('ticketFor').select('-qrCode -ics').exec()
    }
    
    const getAllTickets = async() =>{
        return await model.Ticket.find().select('-qrCode -ics').exec()
    }
    
    let root = typeof exports !== 'undefined' && exports !== null ? exports : window
    root.Ticket = Ticket
    root.createTicket = createTicket
    root.updateTicketById = updateTicketById
    root.getTicketById = getTicketById
    root.deleteTicketById = deleteTicketById,
    root.getAllTicketByEventId = getAllTicketByEventId
    root.getAllTickets = getAllTickets
}).call(this)
(function(){

    const model = require('./mongoModel')
    const logger = require('./logger')

    const Ticket = (function(){
        function Ticket(qrCode, ticketFor, event ){
            this.qrCode = qrCode
            this.ticketFor = ticketFor,
            this.event = event  

        }

        Ticket.prototype.saveToDB = function(){

            const ticket = new model.Ticket({
                qrCode:this.qrCode, 
                ticketFor:this.ticketFor, 
                event:this.event
            }) 
            return  ticket.save()
        }

        return Ticket

    })()

    const createTicket = async(qrCode, ticketFor, event) =>{
          
        const ticket = new Ticket(qrCode, ticketFor, event)
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
    
    let root = typeof exports !== 'undefined' && exports !== null ? exports : window
    root.Ticket = Ticket
    root.createTicket = createTicket
    root.updateTicketById = updateTicketById
    root.getTicketById = getTicketById
    root.deleteTicketById = deleteTicketById
}).call(this)
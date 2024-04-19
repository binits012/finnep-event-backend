'use strict';

require('dotenv').config()
const { Agenda } = require('@hokify/agenda');
const {TicketReport, getAllTicketReport} = require('../model/reporting')
require('../model/dbConnect')
const {retryForward} = require('./sendMail')
const dbURI = `mongodb://${encodeURIComponent(process.env.MONGODB_USER)}:${encodeURIComponent(process.env.MONGODB_PWD)}@${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT}/${process.env.MONGODB_NAME}?authSource=admin&useNewUrlParser=true`;
const logger = require('../model/logger') 
const agenda = new Agenda({ db: { address: dbURI } })
agenda.on('ready', () => console.log("Agenda started!"))
agenda.on('error', () => console.log("Agenda connection error!"))

agenda.define('failure mails', async (job) => { 
	
	const ticket = await TicketReport.find({retryCount:{$lte:5}}) 
	ticket.forEach(async e=>{ 
		const id = e.id
		const emailData = e.emailData
		let retryCount = e.retryCount
		await retryForward(id,emailData,retryCount).then(async (data) =>{
			//email sending was ok, let's remove this
			if(data != null){
				logger.log('info','retrying sending mail to %s ', emailData.to + " successfully completed.")
				await TicketReport.findByIdAndDelete({_id:id}).then(data=>{
					logger.log('info','retrying id  %s', id + " is deleted.")
				})
			}
		}).catch(err =>{
			{
				//do nothing at this point
				logger.log('error','retrying id %s is still failing ', id )
			}
		})

	}) 
}, { priority: 'high', concurrency: 30 });
	
(async () => {
 
  await agenda.start(); // Start the Agenda instance after configuration
  await agenda.every('1 minute', 'failure mails');

})(); 
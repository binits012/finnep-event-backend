'use strict';

require('dotenv').config()
const { Agenda } = require('@hokify/agenda');
const {TicketReport, getAllTicketReport} = require('../model/reporting')
require('../model/dbConnect')
const {forward, retryForward} = require('./sendMail')
const dbURI = `mongodb://${encodeURIComponent(process.env.MONGODB_USER)}:${encodeURIComponent(process.env.MONGODB_PWD)}@${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT}/${process.env.MONGODB_NAME}?authSource=admin&useNewUrlParser=true`;
const logger = require('../model/logger') 
const agenda = new Agenda({ db: { address: dbURI } })
const { getUsersByRole } = require('../model/users')
const { getContactById } = require('../model/contact')
const { ROLE_ADMIN } = require('../const') 
const fs = require('fs/promises')


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
				await TicketReport.findByIdAndDelete({_id:id}).then(data=>{2
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
  await agenda.every('1 hour', 'failure mails');

  process.on('SIGINT', async () => {
	await agenda.stop();
	process.exit(0);
});

})(); 

agenda.define('report failures', async(job) =>{
	const ticket = await TicketReport.find({retryCount:{$gte:5}})
	let emailRows = null
	ticket.forEach(async e=>{ 
		const id = e.id
		let emailList ='<tr><td>'+id+'</td>\n'
		const emailData = e.emailData 
		const email = emailData.to
		emailList +='<td>'+email +'</td>\n'
		const event = emailData.subject
		emailList += '<td>'+event+'</td></tr>\n'
		emailRows +=emailList
	}) 
	const adminUser = await getUsersByRole(ROLE_ADMIN) 
	let ticketIdArray = new Array()
	adminUser.forEach(async e =>{
		const id = e.id
		const contact = await getContactById(id)
		const username = contact.user.name
		let email =  contact.contact[0].data 
		if(email !== null || email !== 'undefined'){
			const fileLocation = __dirname.replace('util', '') +'/emailTemplates/failure_report.html'
			const emailData = await loadEmailTemplate(fileLocation, username, emailRows) 
			if(emailRows !== null){
				const message = {
					from:process.env.EMAIL_USERNAME,
					to:email,
					subject:"Failure emails, do needful",
					html:emailData.toString(),
				}
				await forward(message).then(data=>{
					ticket.forEach(async e=>{
	
						await TicketReport.findByIdAndDelete(e.id).then(data=>{
							logger.log('info', 'deleted failure ticket id %s', e.id)
						})
					})
				}).catch(err=>{
					logger.log('error', err.stack)
				})
			}
			
		}
	})

});

const loadEmailTemplate = async (fileLocation, username, emailRows) =>{
	const emailData = (await fs.readFile(fileLocation,'utf8')).replace('$adminName',username).replace('$trData',emailRows)
	return emailData
}
(async () => {
 
	await agenda.start(); // Start the Agenda instance after configuration
	await agenda.every('day', '08:00:00', 'report failures');
	process.on('SIGINT', async () => {
		await agenda.stop();
		process.exit(0);
	});
  })();
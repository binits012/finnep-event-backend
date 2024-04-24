import * as fs from 'fs/promises'; 
import dotenv from 'dotenv'
dotenv.config()
import  { Agenda } from '@hokify/agenda'
import {TicketReport, getAllTicketReport} from '../model/reporting.js'
 
import  '../model/dbConnect.js'
import  {forward, retryForward} from './sendMail.js'
const dbURI = `mongodb://${encodeURIComponent(process.env.MONGODB_USER)}:${encodeURIComponent(process.env.MONGODB_PWD)}@${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT}/${process.env.MONGODB_NAME}?authSource=admin&useNewUrlParser=true`;
import {error , info} from '../model/logger.js'
const agenda = new Agenda({ db: { address: dbURI } })
import  { getUsersByRole } from '../model/users.js'
import { getContactById } from '../model/contact.js'
import { ROLE_ADMIN } from '../const.js' 

const __dirname = import.meta.dirname;
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
				info( 'retrying sending mail to %s ', emailData.to + " successfully completed.")
				await TicketReport.findByIdAndDelete({_id:id}).then(data=>{2
					info('retrying id  %s', id + " is deleted.")
				})
			}
		}).catch(err =>{
				//do nothing at this point
				error('retrying id %s is still failing ', id )
		})

	}) 
}, { priority: 'high', concurrency: 30 });
	
(async () => {
 
  await agenda.start(); // Start the Agenda instance after configuration
  await agenda.every('45 minutes', 'failure mails');

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
							info(  'deleted failure ticket id %s', e.id)
						})
					})
				}).catch(err=>{
					error('error', err.stack)
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

  
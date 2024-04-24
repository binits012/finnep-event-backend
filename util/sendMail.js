 
import { createTransport } from 'nodemailer'
import {error, info} from '../model/logger.js' 
import dotenv from 'dotenv'
dotenv.config()
import {TicketReport} from '../model/reporting.js'

let transport = createTransport({
    host: process.env.EMAIL_SERVER,
    port: process.env.EMAIL_PORT,
    auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD
    },
    secure: false, 
    ignoreTLS: true
});


export const forward = async (emailData) =>{ 
    if(process.env.SEND_MAIL){ 
        try{ 
            return await new Promise((resolve, reject)=>{
                transport.sendMail(emailData, async function (err, data) {
                    if(err){
                        const msg ={
                            emailData: emailData,
                            isSend:false,
                            retryCount:0,
                        }
                        const reporting = TicketReport(msg)
                        await reporting.save()
                        error('error sending email %s', err)
                        reject(err)
                    } 
                    info('email sent %s', data)
                    resolve(data)
                })
            })
        }catch(err){ 
            const msg ={
                emailData: emailData,
                isSend:false,
                retryCount:0,
            }
            const reporting = TicketReport(msg)
            await reporting.save()
            throw err
        }
    }
    
}

export const retryForward = async (id, emailData, retryCount) => { 
    return await new Promise((resolve, reject)=>{
        transport.sendMail(emailData, async function (err, data) {
            if(err){
                const msg ={
                    retryCount:retryCount+1,
                } 
                await TicketReport.findByIdAndUpdate(id, { $set:  msg },
                    { new: true }).catch(err=>{return {error:err.stack}})
                    error('error sending email %s', err)
                reject(err)
            } 
            info('email sent %s', data)
            resolve(data)
        })
    })
     
}

/*
module.exports = {
    forward,
    retryForward
}
*/

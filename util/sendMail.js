let nodemailer = require("nodemailer");
const logger = require('../model/logger')
let smtpTransport = require('nodemailer-smtp-transport');
require('dotenv').config()  
const {TicketReport} = require('../model/reporting')
let transport = nodemailer.createTransport(smtpTransport({
    host: process.env.EMAIL_SERVER,
    port: process.env.EMAIL_PORT,
    auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD
    },
    secure: false, 
    ignoreTLS: true
}));


const forward = async (emailData) =>{ 
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
                        reject(err)
                    } 
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

const retryForward = async (id, emailData, retryCount) => { 
    return await new Promise((resolve, reject)=>{
        transport.sendMail(emailData, async function (err, data) {
            if(err){
                const msg ={
                    retryCount:retryCount+1,
                } 
                await TicketReport.findByIdAndUpdate(id, { $set:  msg },
                    { new: true }).catch(err=>{return {error:err.stack}})
                reject(err)
            } 
            resolve(data)
        })
    })
     
}

module.exports = {
    forward,
    retryForward
}

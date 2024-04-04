let nodemailer = require("nodemailer");
const logger = require('../model/logger')
let smtpTransport = require('nodemailer-smtp-transport');
require('dotenv').config()  
const mongoose = require('mongoose')
const failureSchema = new mongoose.Schema({}, { strict: false })
const Failure = mongoose.model('Failure', failureSchema)
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
                        const failure = new Failure(msg)
                        await failure.save()
                        reject(err)
                    } 
                    resolve(data)
                })
            })
        }catch(err){
            return err
        }
        /*
        transport.sendMail(emailData, async function (error) {
            if (!error) {
                console.log("Email has been sent");
                logger.log('info', "Email has been sent to %s" , emailData.to )
                
            } else {
                console.log(error)
                logger.log('error', error.stack)
                //something went wrong therefore lets dump the data so that it can be re-tried later
                const msg ={
                    emailData: emailData,
                    isSend:false,
                    retryCount:0,
                }
                 try{ 
                    const failure = new Failure(msg)
                    await failure.save()
                }catch(err){
                    console.log(err)
                }
            }
        })  
        */  
    }
    
}

module.exports = {
    forward
}

import express from 'express' 
import dotenv from 'dotenv'
dotenv.config()
import cors from 'cors'
//import cookieParser from 'cookie-parser'
import  './model/dbConnect.js'
import  './util/uploadQueueProcess.js' 
import * as adminRole from './util/adminUser.js'
import api from './routes/api.js'
import front from './routes/front.js'
import './util/schedular.js'
import path from 'path'

var app = express();
app.use(cors())
app.options('*',cors())
//app.use(logger('dev'));
app.use(express.json({limit: '2gb', extended: false}))
app.use(express.urlencoded({ extended: false }))
//app.use(cookieParser())
app.use('/api', api)
app.use('/front',front)
app.set('port', process.env.PORT || process.env.PORT);

var server = app.listen(app.get('port'), function () {
    console.log('Express server listening on port ' + server.address().port);
})
// create remaining roles
adminRole.createRoles()
//add admin role and  user if not present 
adminRole.createAdmin() 
// create photoTypes
adminRole.photoTypes()
//create notificationTypes
adminRole.notificationTypes()
//create socialMedia
adminRole.socialMedia()

export default app

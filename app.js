'use strict'
const express = require('express')
const path = require('path')
require('dotenv').config() 
require('./model/dbConnect')
var cookieParser = require('cookie-parser');
const adminRole = require('./util/adminUser')
const api = require('./routes/api')
const front = require('./routes/front')
const cors = require('cors')
var app = express();
app.use(cors())
app.options('*',cors())
//app.use(logger('dev'));
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
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
module.exports = app;

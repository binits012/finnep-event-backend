'use strict'
const express = require('express')
const path = require('path')
require('./model/dbConnect')
var cookieParser = require('cookie-parser');
const adminRole = require('./util/adminUser')

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();

//app.use(logger('dev'));
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')))

app.use('/', indexRouter)
app.use('/users', usersRouter)


// create remaining roles
adminRole.createRoles()
//add admin role and  user if not present 
adminRole.createAdmin() 
// create photoTypes
adminRole.photoTypes()
//create notificationTypes
adminRole.notificationTypes()
module.exports = app;

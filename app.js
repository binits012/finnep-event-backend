'use strict'
const express = require('express')
const path = require('path')
require('./model/dbConnect')
var cookieParser = require('cookie-parser');
const adminRole = require('./util/adminUser')

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
const api = require('./routes/api')
var app = express();

//app.use(logger('dev'));
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')))
app.use('/api', api)
app.use('/', indexRouter)
app.use('/users', usersRouter)

app.set('port', process.env.PORT || 3000);
/*
app.use(function(req, res, next) {
	res.status(404).render('error', {  title: 'Not found' });
})
*/
var server = app.listen(app.get('port'), function () {
    console.log('Express server listening on port ' + server.address().port);
}); 
// create remaining roles
adminRole.createRoles()
//add admin role and  user if not present 
adminRole.createAdmin() 
// create photoTypes
adminRole.photoTypes()
//create notificationTypes
adminRole.notificationTypes()
module.exports = app;

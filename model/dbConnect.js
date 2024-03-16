var mongoose = require('mongoose'),
        bcrypt = require('bcrypt'),
        SALT_WORK_FACTOR = 10,
        dbURI = 'mongodb://binit:bajrayoginidevi1312@0.0.0.0:27017/yellowbridge';

//mongoose.connect(dbURI,{auth:{authdb:"admin"}});
mongoose.connect(`mongodb://${encodeURIComponent('binit')}:${encodeURIComponent('bajrayoginidevi1312')}@0.0.0.0:27017/yellowbridge?authSource=admin&useNewUrlParser=true`);
mongoose.connection.on('connected', function () {
        console.log('Mongoose connected to' + dbURI);
});

mongoose.connection.on('error', function (err) {
        console.log('Mongoose connection error: ' + err + dbURI);
});

mongoose.connection.on('disconnected', function () {
        console.log('Mongoose disconnected');    
});

process.on('SIGINT', function () {
        mongoose.connection.close(function () {
                console.log('Mongoose disconnected through app termination');
                process.exit(0);
        })
});


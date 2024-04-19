var mongoose = require('mongoose'), 
        dbURI = `mongodb://${encodeURIComponent(process.env.MONGODB_USER)}:${encodeURIComponent(process.env.MONGODB_PWD)}@${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT}/${process.env.MONGODB_NAME}?authSource=admin&useNewUrlParser=true`;

//mongoose.connect(dbURI,{auth:{authdb:"admin"}});
mongoose.connect(dbURI);
mongoose.connection.on('connected', function () {
        console.log('Mongoose connected to ' + dbURI);
});

mongoose.connection.on('error', function (err) {
        console.log('Mongoose connection error: ' + err + dbURI);
});

mongoose.connection.on('disconnected', function () {
        console.log('Mongoose disconnected');    
});

process.on('SIGINT', function () {
        mongoose.connection.close().then(()=>{
                console.log('Mongoose disconnected through app termination');
                process.exit(0);
        })
});


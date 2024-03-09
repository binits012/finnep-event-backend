 
'use strict'
let winston = require('winston')

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.json(),
    winston.format.splat(),
    winston.format.simple()
  ),
   
  level: 'info',
  transports: [
    new (require('winston-daily-rotate-file'))({
      name: 'fileß',
      datePattern: '.yyyy-MM-DD',
      filename: './logs/combined.log',
      maxsize: 1024 * 1024 * 2
    }) // 10MB})
  ]
});

module.exports = logger

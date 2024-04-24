 
import * as winston from 'winston'  
import  'winston-daily-rotate-file';
const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.json(),
    winston.format.splat(),
    winston.format.simple()
  ),
   
  level: 'info',
  transports: [
    new  winston.transports.DailyRotateFile({
      name: 'fileß',
      datePattern: 'yyyy-MM-DD',
      filename: './logs/combined.log',
      maxsize: 1024 * 1024 * 2
    }) // 10MB})
  ]
});

export const info = logger.info.bind(logger)
export const warn = logger.warn.bind(logger)
export const error = logger.error.bind(logger)
export const debug = logger.debug.bind(logger)

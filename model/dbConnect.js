
import mongoose from 'mongoose';
import dotenv from 'dotenv'
dotenv.config()

const user = encodeURIComponent(process.env.MONGODB_USER || 'eventapp');
const pwd = encodeURIComponent(process.env.MONGODB_PWD || '');
const host = process.env.MONGODB_HOST || 'localhost';
const port = process.env.MONGODB_PORT || '27017';
const dbName = process.env.MONGODB_NAME || 'eventapp';
const authSource = process.env.MONGODB_AUTH_SOURCE || dbName;

const dbURI = `mongodb://${user}:${pwd}@${host}:${port}/${dbName}?authSource=${authSource}`;

const isProduction = process.env.NODE_ENV === 'production';

const options = {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  retryWrites: true,
  retryReads: true,
  maxPoolSize: isProduction ? 50 : 10,
  minPoolSize: isProduction ? 10 : 1,
};

let connectPromise = null;
let initialRetryTimer = null;

function logConnectionTarget() {
  const maskedURI = dbURI.replace(/:([^:@]+)@/, ':***@');
  console.log('Attempting MongoDB connection to:', maskedURI);
  console.log('User:', user ? decodeURIComponent(user) : 'not set');
  console.log('Host:', host);
  console.log('Port:', port);
  console.log('Database:', dbName);
  console.log('AuthSource:', authSource);
}

async function dbConnect() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectPromise) {
    return connectPromise;
  }

  logConnectionTarget();

  connectPromise = mongoose.connect(dbURI, options)
    .then(() => {
      console.log('✅ Mongoose connected successfully!');
      return mongoose.connection;
    })
    .catch((err) => {
      connectPromise = null;
      const maskedURI = dbURI.replace(/:([^:@]+)@/, ':***@');
      console.error('❌ Mongoose connection error:', err.message);
      console.error('Connection string used:', maskedURI);

      if (!initialRetryTimer) {
        initialRetryTimer = setTimeout(() => {
          initialRetryTimer = null;
          console.log('Retrying MongoDB connection...');
          void dbConnect();
        }, 5000);
      }

      throw err;
    });

  return connectPromise;
}

mongoose.connection.on('error', (err) => {
  console.log('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected — driver will reconnect automatically');
});

mongoose.connection.on('reconnected', () => {
  console.log('Mongoose reconnected successfully');
});

process.on('SIGINT', async () => {
  if (initialRetryTimer) {
    clearTimeout(initialRetryTimer);
    initialRetryTimer = null;
  }
  await mongoose.connection.close();
  console.log('Mongoose disconnected through app termination');
  process.exit(0);
});

void dbConnect();

export default dbConnect;

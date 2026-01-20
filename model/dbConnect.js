
import mongoose from 'mongoose';
import dotenv from 'dotenv'
dotenv.config()
// Build MongoDB connection URI
// Note: authSource must match the database where the user was created
const user = encodeURIComponent(process.env.MONGODB_USER || 'eventapp');
const pwd = encodeURIComponent(process.env.MONGODB_PWD || '');
const host = process.env.MONGODB_HOST || 'localhost';
const port = process.env.MONGODB_PORT || '27017';
const dbName = process.env.MONGODB_NAME || 'eventapp';
const authSource = process.env.MONGODB_AUTH_SOURCE || dbName;

const dbURI = `mongodb://${user}:${pwd}@${host}:${port}/${dbName}?authSource=${authSource}`;

const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000, // Increased for development resilience
  socketTimeoutMS: 45000,  // Close sockets after 45 seconds of inactivity
  keepAlive: true,         // Enable keepAlive
  keepAliveInitialDelay: 300000,  // Send keepAlive every 5 minutes (300000 ms)
  // Auto-reconnect options
  retryWrites: true,
  retryReads: true,
  maxPoolSize: 50,               // ✅ ADD - increase connection pool
  minPoolSize: 10,  
};

// Connect to MongoDB
async function dbConnect() {
  try {
    // Log connection attempt (mask password for security)
    const maskedURI = dbURI.replace(/:([^:@]+)@/, ':***@');
    console.log('Attempting MongoDB connection to:', maskedURI);
    console.log('User:', user ? decodeURIComponent(user) : 'not set');
    console.log('Host:', host);
    console.log('Port:', port);
    console.log('Database:', dbName);
    console.log('AuthSource:', authSource);

    await mongoose.connect(dbURI, options)
    console.log('✅ Mongoose connected successfully!')
  } catch (err) {
    const maskedURI = dbURI.replace(/:([^:@]+)@/, ':***@');
    console.error('❌ Mongoose connection error:', err.message);
    console.error('Error code:', err.code);
    console.error('Error codeName:', err.codeName);
    console.error('Connection string used:', maskedURI);
    console.error('Full error:', err);

    // Retry connection after 5 seconds
    setTimeout(() => {
      console.log('Retrying MongoDB connection...')
      dbConnect()
    }, 5000)
  }
}

// Handle connection events
dbConnect()

mongoose.connection.on('error', (err) => {
  console.log('Mongoose connection error: ' + err)
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected - will attempt to reconnect')
  // Mongoose will automatically attempt to reconnect, but we can also trigger it manually
  if (mongoose.connection.readyState === 0) {
    setTimeout(() => {
      console.log('Attempting to reconnect to MongoDB...')
      dbConnect()
    }, 5000)
  }
});

mongoose.connection.on('reconnected', () => {
  console.log('Mongoose reconnected successfully')
});

// Handle application termination (SIGINT)
process.on('SIGINT', async () => {
  await mongoose.connection.close()
  console.log('Mongoose disconnected through app termination')
  process.exit(0)
});

export default dbConnect;

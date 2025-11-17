
import mongoose from 'mongoose';
import dotenv from 'dotenv'
dotenv.config()
const dbURI = `mongodb://${encodeURIComponent(process.env.MONGODB_USER)}:${encodeURIComponent(process.env.MONGODB_PWD)}@${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT}/${process.env.MONGODB_NAME}?authSource=admin&useNewUrlParser=true`;

const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000, // Increased for development resilience
  socketTimeoutMS: 45000,  // Close sockets after 45 seconds of inactivity
  keepAlive: true,         // Enable keepAlive
  keepAliveInitialDelay: 300000,  // Send keepAlive every 5 minutes (300000 ms)
  // Auto-reconnect options
  retryWrites: true,
  retryReads: true
};

// Connect to MongoDB
async function dbConnect() {
  try {
    await mongoose.connect(dbURI, options)
    console.log('Mongoose connected to ' + dbURI)
  } catch (err) {
    console.log('Mongoose connection error: ' + err + dbURI)
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

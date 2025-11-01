/**
 * Utility script to unlock stuck Agenda jobs
 * Usage: node unlock-agenda-jobs.mjs [jobName]
 *
 * Examples:
 *   node unlock-agenda-jobs.mjs                    // Unlock all stuck jobs
 *   node unlock-agenda-jobs.mjs "inactive past events"  // Unlock specific job
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const dbURI = `mongodb://${encodeURIComponent(process.env.MONGODB_USER)}:${encodeURIComponent(process.env.MONGODB_PWD)}@${process.env.MONGODB_HOST}:${process.env.MONGODB_PORT}/${process.env.MONGODB_NAME}?authSource=admin&useNewUrlParser=true`;

const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  keepAlive: true,
  keepAliveInitialDelay: 300000
};

async function unlockJobs(jobName = null) {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(dbURI, options);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const agendaCollection = db.collection('agendaJobs');

    // Build query
    const query = { lockedAt: { $exists: true } };
    if (jobName) {
      query.name = jobName;
    }

    // Find locked jobs
    const lockedJobs = await agendaCollection.find(query).toArray();

    if (lockedJobs.length === 0) {
      console.log(jobName ? `No locked jobs found with name: ${jobName}` : 'No locked jobs found');
      await mongoose.disconnect();
      return;
    }

    console.log(`\nFound ${lockedJobs.length} locked job(s):`);
    lockedJobs.forEach((job, index) => {
      console.log(`\n${index + 1}. Job: ${job.name}`);
      console.log(`   Locked at: ${job.lockedAt}`);
      console.log(`   Last finished: ${job.lastFinishedAt || 'Never'}`);
      console.log(`   Next run: ${job.nextRunAt}`);
    });

    // Unlock jobs
    const result = await agendaCollection.updateMany(
      query,
      { $unset: { lockedAt: '' } }
    );

    console.log(`\n✓ Unlocked ${result.modifiedCount} job(s)`);

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error unlocking jobs:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Get job name from command line argument
const jobName = process.argv[2];

unlockJobs(jobName);


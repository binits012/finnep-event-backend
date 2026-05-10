import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

import '../model/dbConnect.js'
import { User } from '../model/mongoModel.js'
import * as consts from '../const.js'
import { info, error } from '../model/logger.js'

async function waitForConnection() {
	let retries = 0
	const maxRetries = 30

	while (mongoose.connection.readyState !== 1 && retries < maxRetries) {
		await new Promise(resolve => setTimeout(resolve, 1000))
		retries++
	}

	if (mongoose.connection.readyState !== 1) {
		throw new Error('Failed to connect to MongoDB')
	}
}

async function backfillUserRegionalScopes() {
	await waitForConnection()

	const filter = {
		$or: [
			{ scopeType: { $exists: false } },
			{ scopeType: null },
			{ allowedCountryCodes: { $exists: false } },
			{ allowedCountryCodes: null }
		]
	}

	const result = await User.updateMany(
		filter,
		{
			$set: {
				scopeType: consts.ACCESS_SCOPE_GLOBAL,
				allowedCountryCodes: []
			}
		},
		{ runValidators: false }
	)

	info('User regional scope backfill completed', {
		matched: result.matchedCount,
		modified: result.modifiedCount
	})

	console.log('\n=== User Regional Scope Backfill ===')
	console.log(`Matched: ${result.matchedCount}`)
	console.log(`Modified: ${result.modifiedCount}`)
	console.log('Default: scopeType=global, allowedCountryCodes=[]')
	console.log('====================================\n')
}

backfillUserRegionalScopes()
	.then(() => process.exit(0))
	.catch(err => {
		error('User regional scope backfill failed:', err)
		console.error('User regional scope backfill failed:', err)
		process.exit(1)
	})

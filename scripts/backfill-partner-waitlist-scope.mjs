#!/usr/bin/env node

import dotenv from 'dotenv'
import mongoose from 'mongoose'
import '../model/dbConnect.js'
import { Merchant } from '../model/mongoModel.js'

dotenv.config()

const isDryRun = process.argv.includes('--dry-run')

async function waitForConnection() {
	if (mongoose.connection.readyState === 1) return
	await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('MongoDB connection timeout')), 30000)
		mongoose.connection.once('connected', () => {
			clearTimeout(timeout)
			resolve()
		})
		mongoose.connection.once('error', (err) => {
			clearTimeout(timeout)
			reject(err)
		})
	})
}

async function backfillPartnerWaitlistScope() {
	await waitForConnection()

	const merchants = await Merchant.find({
		'apiCredentials.status': 'active'
	}).select('_id merchantId name apiCredentials')

	let updatedCredentials = 0

	for (const merchant of merchants) {
		let changed = false

		for (const credential of merchant.apiCredentials || []) {
			if (credential.status !== 'active') continue
			const scopes = Array.isArray(credential.scopes) ? credential.scopes : []
			const isSiloCredential = scopes.includes('events:read') && scopes.includes('merchant:read')
			if (!isSiloCredential || scopes.includes('waitlist:write')) continue

			if (isDryRun) {
				console.log(`[dry-run] would add waitlist:write to ${merchant.merchantId || merchant._id} key ${credential.keyId}`)
			} else {
				credential.scopes = [...scopes, 'waitlist:write']
			}
			updatedCredentials++
			changed = true
		}

		if (changed && !isDryRun) {
			merchant.updatedAt = new Date()
			await merchant.save()
		}
	}

	console.log(`[partner waitlist scope] ${isDryRun ? 'would update' : 'updated'} ${updatedCredentials} credential(s)`)
}

backfillPartnerWaitlistScope()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err)
		process.exit(1)
	})

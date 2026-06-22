#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import '../model/dbConnect.js'
import { Merchant } from '../model/mongoModel.js'
import { normalizeSiloSettings } from '../util/siloSettings.js'
import { isSiloSmtpConfigured } from '../util/siloEmailSettings.js'

dotenv.config()

const isDryRun = process.argv.includes('--dry-run')

const pgConfig = {
	host: process.env.EMS_DB_HOST || 'localhost',
	port: process.env.EMS_DB_PORT || '5432',
	user: process.env.EMS_DB_USER || 'event_merchant_user',
	password: process.env.EMS_DB_PASSWORD || '',
	database: process.env.EMS_DB_NAME || 'event_merchant'
}

function fetchMerchantsWithSiloEmailFromEms() {
	const sql = `
		SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
		FROM (
			SELECT id::text AS merchant_id, silo_settings
			FROM orginfo
			WHERE silo_settings->'email'->'smtp'->>'host' IS NOT NULL
				AND silo_settings->'email'->'smtp'->>'host' <> ''
		) t;
	`

	const result = spawnSync('psql', [
		'-h', pgConfig.host,
		'-p', String(pgConfig.port),
		'-U', pgConfig.user,
		'-d', pgConfig.database,
		'-t', '-A',
		'-c', sql
	], {
		encoding: 'utf8',
		env: { ...process.env, PGPASSWORD: pgConfig.password }
	})

	if (result.status !== 0) {
		throw new Error(result.stderr || 'Failed to query EMS PostgreSQL')
	}

	const rows = JSON.parse(result.stdout.trim() || '[]')
	return Array.isArray(rows) ? rows : []
}

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

async function backfillSiloEmailToMongo() {
	const rows = fetchMerchantsWithSiloEmailFromEms()
	console.log(`[silo email backfill] found ${rows.length} EMS merchant(s) with SMTP configured`)

	if (rows.length === 0) return

	await waitForConnection()

	let updated = 0
	for (const row of rows) {
		const merchantId = String(row.merchant_id)
		const siloFromEms = row.silo_settings && typeof row.silo_settings === 'object'
			? row.silo_settings
			: null
		if (!siloFromEms?.email || !isSiloSmtpConfigured(siloFromEms.email)) continue

		const merchant = await Merchant.findOne({ merchantId }).select('_id siloSettings').exec()
		if (!merchant) {
			console.warn(`[silo email backfill] skip ${merchantId}: not found in MongoDB`)
			continue
		}

		const existingSilo = merchant.siloSettings && typeof merchant.siloSettings.toObject === 'function'
			? merchant.siloSettings.toObject()
			: (merchant.siloSettings || {})
		const siloSettings = normalizeSiloSettings(siloFromEms, existingSilo)

		if (isDryRun) {
			console.log(`[dry-run] would sync email for merchant ${merchantId}`)
			updated++
			continue
		}

		merchant.siloSettings = siloSettings
		merchant.updatedAt = Date.now()
		await merchant.save()
		updated++
		console.log(`[silo email backfill] synced email for merchant ${merchantId}`)
	}

	console.log(`[silo email backfill] ${isDryRun ? 'would update' : 'updated'} ${updated} merchant(s)`)
}

backfillSiloEmailToMongo()
	.then(async () => {
		await mongoose.disconnect()
		process.exit(0)
	})
	.catch(async (err) => {
		console.error(err)
		try { await mongoose.disconnect() } catch {}
		process.exit(1)
	})

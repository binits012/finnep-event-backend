import { describe, it, expect, beforeAll } from '@jest/globals'
import { encryptSiloSmtpPassword, decryptSiloSmtpPassword, hasEncryptedSiloSmtpPassword } from '../../../util/siloSmtpCrypto.js'

describe('siloSmtpCrypto', () => {
	beforeAll(() => {
		process.env.CRYPTO_KEY = process.env.CRYPTO_KEY || 'test-crypto-key-minimum-32-characters-long'
	})

	it('encrypts and decrypts SMTP password round-trip', () => {
		const encrypted = encryptSiloSmtpPassword('smtp-secret-123')
		expect(hasEncryptedSiloSmtpPassword(encrypted)).toBe(true)
		expect(decryptSiloSmtpPassword(encrypted)).toBe('smtp-secret-123')
	})

	it('decrypts even when CRYPTO_SALT differs from silo SMTP salt', () => {
		const encrypted = encryptSiloSmtpPassword('smtp-secret-456')
		process.env.CRYPTO_SALT = 'finnep-default-salt-2024'
		expect(decryptSiloSmtpPassword(encrypted)).toBe('smtp-secret-456')
	})
})

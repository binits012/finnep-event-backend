import CryptoLibrary from 'crypto'

const algorithm = 'aes-256-cbc'
const DEFAULT_SALT = 'finnep-silo-smtp-v1'

function getSiloSmtpCryptoKey() {
	const key = process.env.SILO_SMTP_CRYPTO_KEY || process.env.CRYPTO_KEY
	if (!key) {
		throw new Error('SILO_SMTP_CRYPTO_KEY or CRYPTO_KEY environment variable is required')
	}
	return key
}

function getSiloSmtpCryptoSalt() {
	// Must not reuse CRYPTO_SALT — EMS and FEB often use different values.
	return process.env.SILO_SMTP_CRYPTO_SALT || DEFAULT_SALT
}

function deriveKey() {
	return CryptoLibrary.scryptSync(getSiloSmtpCryptoKey(), getSiloSmtpCryptoSalt(), 32)
}

/** Encrypt silo SMTP password for storage (EMS encrypt, FEB decrypt). */
export function encryptSiloSmtpPassword(plaintext) {
	if (typeof plaintext !== 'string' || !plaintext) {
		throw new Error('SMTP password must be a non-empty string')
	}
	const iv = CryptoLibrary.randomBytes(16)
	const cipher = CryptoLibrary.createCipheriv(algorithm, deriveKey(), iv)
	let encrypted = cipher.update(plaintext, 'utf8', 'hex')
	encrypted += cipher.final('hex')
	return {
		iv: iv.toString('hex'),
		encryptedData: encrypted
	}
}

/** Decrypt silo SMTP password blob. */
export function decryptSiloSmtpPassword(passwordBlob) {
	if (!passwordBlob || typeof passwordBlob !== 'object') {
		throw new Error('Invalid SMTP password blob')
	}
	const { iv, encryptedData } = passwordBlob
	if (!iv || !encryptedData) {
		throw new Error('Invalid SMTP password blob')
	}
	const decipher = CryptoLibrary.createDecipheriv(algorithm, deriveKey(), Buffer.from(iv, 'hex'))
	let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
	decrypted += decipher.final('utf8')
	return decrypted
}

export function hasEncryptedSiloSmtpPassword(passwordBlob) {
	return Boolean(
		passwordBlob
		&& typeof passwordBlob === 'object'
		&& typeof passwordBlob.iv === 'string'
		&& passwordBlob.iv
		&& typeof passwordBlob.encryptedData === 'string'
		&& passwordBlob.encryptedData
	)
}

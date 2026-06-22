import { describe, it, expect } from '@jest/globals'
import { normalizeSiloSettings, toPartnerThemePayload, mergeSiloSettingsFromEmsSync } from '../../../util/siloSettings.js'

describe('siloSettings util', () => {
	it('normalizes partial settings with defaults', () => {
		const result = normalizeSiloSettings({
			enabled: true,
			themePreset: 'festival',
			brandConfig: {
				primaryColor: '#ff4d6d'
			},
			legal: {
				privacyPolicyHtml: '<p>Custom privacy</p>'
			}
		})

		expect(result.enabled).toBe(true)
		expect(result.themePreset).toBe('festival')
		expect(result.brandConfig.primaryColor).toBe('#ff4d6d')
		expect(result.brandConfig.darkColor).toBe('#050505')
		expect(result.brandConfig.heroStyle).toBe('poster')
		expect(result.legal.privacyPolicyHtml).toBe('<p>Custom privacy</p>')
		expect(result.legal.termsHtml).toBe('')
	})

	it('rejects invalid preset and colors', () => {
		const result = normalizeSiloSettings({
			themePreset: 'invalid',
			brandConfig: {
				primaryColor: 'red',
				darkColor: '#12345'
			}
		})

		expect(result.themePreset).toBe('cinematic')
		expect(result.brandConfig.primaryColor).toBe('#f5b700')
		expect(result.brandConfig.darkColor).toBe('#050505')
	})

	it('normalizes email settings defaults', () => {
		const result = normalizeSiloSettings({ enabled: true })
		expect(result.email.smtp.host).toBe('')
		expect(result.email.smtp.port).toBe(587)
		expect(result.email.replyTo).toBe('')
	})

	it('preserves existing email when incoming payload omits it', () => {
		const result = normalizeSiloSettings(
			{ enabled: true, themePreset: 'festival' },
			{
				email: {
					smtp: {
						host: 'smtp.example.com',
						port: 587,
						user: 'user',
						fromEmail: 'events@example.com',
						password: { iv: 'abc', encryptedData: 'def' }
					},
					replyTo: 'support@example.com'
				}
			}
		)
		expect(result.email.smtp.host).toBe('smtp.example.com')
		expect(result.email.smtp.password.encryptedData).toBe('def')
	})

	it('mergeSiloSettingsFromEmsSync keeps platform-controlled enabled flag', () => {
		const result = mergeSiloSettingsFromEmsSync(
			{ enabled: false, themePreset: 'festival', deployment: { s3Bucket: 'from-ems' } },
			{
				enabled: true,
				themePreset: 'cinematic',
				deployment: { s3Bucket: 'platform-bucket', cloudfrontDistributionId: 'E123' }
			}
		)
		expect(result.enabled).toBe(true)
		expect(result.themePreset).toBe('festival')
		expect(result.deployment.s3Bucket).toBe('platform-bucket')
		expect(result.deployment.cloudfrontDistributionId).toBe('E123')
	})

	it('builds partner theme payload with merchant logo fallback', () => {
		const theme = toPartnerThemePayload({
			logo: 'https://cdn.example.com/logo.png',
			siloSettings: {
				enabled: true,
				domain: 'tickets.example.com',
				themePreset: 'gallery',
				brandConfig: {
					primaryColor: '#d4af37',
					darkColor: '#111827',
					fontProfile: 'classic',
					heroStyle: 'split'
				}
			}
		})

		expect(theme.themePreset).toBe('gallery')
		expect(theme.brandConfig.logoUrl).toBe('https://cdn.example.com/logo.png')
		expect(theme.enabled).toBe(true)
		expect(theme.domain).toBe('tickets.example.com')
	})
})

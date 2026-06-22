import { describe, it, expect } from '@jest/globals'
import { sectionsToHtml } from '../../../util/legalContent.js'
import { sanitizeLegalHtml, normalizeSiloLegal } from '../../../util/sanitizeLegalHtml.js'

describe('legalContent util', () => {
	it('converts structured sections to HTML', () => {
		const html = sectionsToHtml({
			intro: {
				title: 'Introduction',
				text: 'Welcome to our platform.',
				bullet_points: ['Point one', 'Point two'],
				note: 'Important note'
			}
		})

		expect(html).toContain('<h2>Introduction</h2>')
		expect(html).toContain('<p>Welcome to our platform.</p>')
		expect(html).toContain('<li>Point one</li>')
		expect(html).toContain('<strong>Note:</strong> Important note')
	})

	it('escapes HTML in section text', () => {
		const html = sectionsToHtml({
			unsafe: {
				title: '<script>alert(1)</script>',
				text: 'Safe & sound'
			}
		})

		expect(html).not.toContain('<script>')
		expect(html).toContain('&lt;script&gt;')
		expect(html).toContain('Safe &amp; sound')
	})
})

describe('sanitizeLegalHtml util', () => {
	it('strips scripts and event handlers', () => {
		const result = sanitizeLegalHtml('<p onclick="alert(1)">Hi</p><script>alert(1)</script>')
		expect(result).not.toContain('<script')
		expect(result).not.toContain('onclick')
	})

	it('normalizes silo legal fields', () => {
		expect(normalizeSiloLegal({
			privacyPolicyHtml: '  <p>Privacy</p>  ',
			termsHtml: '<iframe src="x"></iframe><p>Terms</p>'
		})).toEqual({
			privacyPolicyHtml: '<p>Privacy</p>',
			termsHtml: '<p>Terms</p>'
		})
	})
})

import { describe, it, expect } from '@jest/globals';
import {
    normalizeRegistrationForm,
    validateRegistrationAnswers,
    getRegistrationFormFromEvent,
} from '../../../util/registrationForm.js';

describe('registrationForm', () => {
    it('returns null for missing or empty form', () => {
        expect(normalizeRegistrationForm(null)).toBeNull();
        expect(normalizeRegistrationForm({ fields: [] })).toBeNull();
    });

    it('normalizes valid fields and drops invalid ones', () => {
        const form = normalizeRegistrationForm({
            fields: [
                { id: 'full_name', type: 'text', label: 'Full name', required: true },
                { id: 'email', type: 'text', label: 'Bad reserved' },
                { id: 'bad id', type: 'text', label: 'Spaces' },
                { id: 'meal', type: 'select', label: 'Meal', options: ['Veg', 'Meat'] },
                { id: 'size', type: 'radio', label: 'Size', options: ['S', 'M', 'L'] },
                { id: 'terms', type: 'checkbox', label: 'I agree', required: true },
            ],
        });

        expect(form.fields).toHaveLength(4);
        expect(form.fields.map((f) => f.id)).toEqual(['full_name', 'meal', 'size', 'terms']);
    });

    it('validates radio answers against options', () => {
        const form = normalizeRegistrationForm({
            fields: [{ id: 'size', type: 'radio', label: 'Size', required: true, options: ['S', 'M'] }],
        });
        expect(validateRegistrationAnswers(form, {}).valid).toBe(false);
        expect(validateRegistrationAnswers(form, { size: 'XL' }).valid).toBe(false);
        const ok = validateRegistrationAnswers(form, { size: 'M' });
        expect(ok.valid).toBe(true);
        expect(ok.sanitizedAnswers.size).toBe('M');
    });

    it('reads form from event.otherInfo', () => {
        const event = {
            otherInfo: {
                registrationForm: {
                    fields: [{ id: 'org', type: 'text', label: 'Organization' }],
                },
            },
        };
        expect(getRegistrationFormFromEvent(event)?.fields).toHaveLength(1);
    });

    it('validates required custom fields', () => {
        const form = normalizeRegistrationForm({
            fields: [
                { id: 'full_name', type: 'text', label: 'Full name', required: true },
                { id: 'terms', type: 'checkbox', label: 'Terms', required: true },
            ],
        });

        const missing = validateRegistrationAnswers(form, {});
        expect(missing.valid).toBe(false);
        expect(missing.errors.length).toBeGreaterThan(0);

        const ok = validateRegistrationAnswers(form, {
            full_name: 'Ada Lovelace',
            terms: true,
        });
        expect(ok.valid).toBe(true);
        expect(ok.sanitizedAnswers.full_name).toBe('Ada Lovelace');
        expect(ok.sanitizedAnswers.terms).toBe(true);
    });

    it('rejects unknown answer keys', () => {
        const form = normalizeRegistrationForm({
            fields: [{ id: 'note', type: 'text', label: 'Note' }],
        });
        const result = validateRegistrationAnswers(form, { note: 'hi', extra: 'nope' });
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes('Unknown field'))).toBe(true);
    });

    it('allows empty answers when no form is configured', () => {
        const result = validateRegistrationAnswers(null, { anything: 'x' });
        expect(result.valid).toBe(true);
        expect(result.sanitizedAnswers).toEqual({});
    });
});

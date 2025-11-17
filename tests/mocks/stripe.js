/**
 * Stripe Mock
 * Mock Stripe API for testing
 */

import { jest } from '@jest/globals';

export const createStripeMock = () => {
  const mockStripe = {
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_test_1234567890',
          url: 'https://checkout.stripe.com/test',
          payment_status: 'unpaid'
        }),
        retrieve: jest.fn().mockResolvedValue({
          id: 'cs_test_1234567890',
          payment_status: 'paid',
          metadata: {}
        })
      }
    },
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_test_1234567890',
        status: 'requires_payment_method',
        amount: 5000,
        currency: 'eur'
      }),
      retrieve: jest.fn().mockResolvedValue({
        id: 'pi_test_1234567890',
        status: 'succeeded',
        amount: 5000,
        currency: 'eur'
      })
    },
    webhooks: {
      constructEvent: jest.fn().mockImplementation((payload, signature, secret) => {
        return JSON.parse(payload);
      })
    }
  };

  return mockStripe;
};

export default createStripeMock;


export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.test.js', '**/?(*.)+(spec|test).js'],
  collectCoverageFrom: [
    'controllers/**/*.js',
    'model/**/*.js',
    'util/**/*.js',
    'services/**/*.js',
    'rabbitMQ/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**',
    '!**/dist/**',
    '!**/logs/**'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  moduleFileExtensions: ['js', 'json'],
  transform: {},
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
  verbose: true,
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage'
};


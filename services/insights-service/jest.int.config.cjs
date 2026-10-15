const base = require('./jest.base.cjs');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  testTimeout: 60_000,
  setupFiles: ['<rootDir>/test/integration/setup-env.ts'],
};

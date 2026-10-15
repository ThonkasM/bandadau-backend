const base = require('./jest.base.cjs');

module.exports = { ...base, testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] };

const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }] },
};
module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    { ...base, testEnvironment: '<rootDir>/test/support/jest-env-ort.js', displayName: 'integration', testMatch: ['<rootDir>/test/integration/**/*.spec.ts'], testTimeout: 60000 },
  ],
};

/** Shared Jest settings: SWC (decorators + metadata) and ESM-only `jose` transpiled to CommonJS. */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/)?jose)'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};

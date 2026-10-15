import node from '@bandada/eslint-config/node';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'jest.config.js', '.dependency-cruiser.cjs'] },
  ...node,
  { files: ['test/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-non-null-assertion': 'off', '@typescript-eslint/no-unsafe-assignment': 'off' } },
];

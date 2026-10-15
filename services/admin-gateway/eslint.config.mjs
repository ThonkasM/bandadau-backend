import node from '@bandada/eslint-config/node';

export default [...node, { ignores: ['dist/**', 'coverage/**', '*.cjs'] }];

const rootConfig = require('../../eslint.config.cjs');

module.exports = [
  ...rootConfig,
  {
    files: ['apps/agent/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['apps/agent/tsconfig.json', 'apps/agent/tsconfig.spec.json'],
        tsconfigRootDir: require('node:path').join(__dirname, '../..')
      }
    }
  }
];

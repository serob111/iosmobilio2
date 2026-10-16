const expoConfig = require('eslint-config-expo/flat');
const { version: reactVersion } = require('react/package.json');

// eslint-plugin-react's auto-detection calls the ESLint-9-removed context.getFilename();
// pinning settings.react.version explicitly skips that code path entirely.
module.exports = [
  ...expoConfig,
  {
    settings: {
      react: { version: reactVersion },
    },
  },
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
];

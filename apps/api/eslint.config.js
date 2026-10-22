import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Calling fetch directly on a URL this app doesn't control (site analysis, icon
    // downloads, the preview proxy) is an SSRF hole — safeFetch (src/net/safe-fetch.ts)
    // is the only place allowed to call it, since it validates the target first. Test
    // files are exempt: they legitimately fetch real URLs to assert on, e.g. a signed
    // storage url returned by the app under test. resend-mail-sender.ts is exempt too —
    // its one fetch target is a hardcoded, trusted third-party API url, never derived
    // from user input.
    files: ['src/**/*.ts'],
    ignores: ['src/net/safe-fetch.ts', '**/*.spec.ts', 'src/mail/resend-mail-sender.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Use safeFetch from src/net/safe-fetch.ts instead of calling fetch directly on a user-supplied URL.',
        },
      ],
    },
  },
);

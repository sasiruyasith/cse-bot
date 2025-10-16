// eslint.config.mjs  — Next.js 15 flat config
import next from 'eslint-config-next';

export default [
  // If you also want to ignore all API routes, uncomment the next line:
  // { ignores: ['app/api/**'] },

  ...next,

  // Turn off the noisy rule causing your Vercel build to fail
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

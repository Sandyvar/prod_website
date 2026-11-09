import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/tests/**/*.test.ts'],
    environment: 'node',
    env: { BCRYPT_ROUNDS: '4', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' },
  },
});

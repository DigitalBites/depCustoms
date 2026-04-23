import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/test/unit/**/*.test.ts'],
          environment: 'node',
          // Provide a fake DATABASE_URL so db/index.ts does not throw at import time.
          // Unit tests mock the db module — no real connection is made.
          env: {
            DATABASE_URL: 'postgresql://localhost/customs-unit-fake',
            INTERNAL_SERVICE_JWT_PRIVATE_JWK:
              '{"kty":"EC","crv":"P-256","x":"test-x","y":"test-y","d":"test-d","alg":"ES256"}',
            INTERNAL_SERVICE_JWT_KEY_ID: 'test-internal-service-1',
          },
        },
      },
      {
        test: {
          name: 'service-integration',
          include: ['src/test/service-integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['src/test/helpers/setup-integration.ts'],
          // DATABASE_URL must be provided externally — real Postgres required.
          // Run via: make test-service-integration (CI integration phase only).
          testTimeout: 15_000,
        },
      },
    ],
  },
});

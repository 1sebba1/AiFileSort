module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['tests/e2e'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  transform: {
    '^.+\.tsx?$': ['ts-jest', {
      tsconfig: {
        skipLibCheck: true,
      },
    }],
  },
  // Allow ml-kmeans to be required even though it's ESM
  testEnvironmentOptions: {
    testTimeout: 120000,
  },
};

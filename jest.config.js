module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['tests/e2e'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        skipLibCheck: true,
      },
    },
  },
};

export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.(test|spec).ts'],
  testPathIgnorePatterns: ['/lib/'],
  transform: {
    '^.+\\.tsx?$': ['esbuild-jest', { sourcemap: true }],
  },
};

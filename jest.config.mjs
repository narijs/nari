export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.(test|spec).ts'],
  testPathIgnorePatterns: ['/lib/'],
  modulePaths: ['lib'],
  globalSetup: './jest.setup.cjs',
  transform: {
    '^.+\\.tsx?$': ['esbuild-jest', { sourcemap: true }],
  },
};

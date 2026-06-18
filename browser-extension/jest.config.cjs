module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.{js,jsx}'],
  collectCoverageFrom: ['src/lib/detectors.js'],
  coverageDirectory: 'coverage',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
};

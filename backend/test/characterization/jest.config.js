// Suite de caracterización contra base Postgres real (ver README.md).
// Una sola base compartida => ejecución SERIE (maxWorkers: 1).
module.exports = {
  rootDir: '../..',
  testRegex: 'test/characterization/.*\\.char-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  // @nestjs/schedule v12 es ESM-only; se transpila a CJS para poder cargar la
  // AppModule completa dentro de Jest (el jest unitario no la carga).
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/test/characterization/tsconfig.json' }] },
  transformIgnorePatterns: ['/node_modules/(?!(@nestjs/schedule)/)'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
  maxWorkers: 1,
  testTimeout: 30000,
  globalSetup: '<rootDir>/test/characterization/global-setup.ts',
  setupFiles: ['<rootDir>/test/characterization/setup-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/characterization/after-env.ts'],
};

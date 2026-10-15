import boundaries from 'eslint-plugin-boundaries';

/**
 * Flat ESLint config for the server.
 *
 * The project uses a clean-architecture layout. Keep the architectural vocabulary here even
 * where a layer is allowed to depend on another layer; this makes the lint:boundaries command
 * useful and leaves the dependency policy in one obvious place.
 */
export default [
  {
    files: ['src/**/*.js', 'test/**/*.js', 'scripts/**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/domain/*' },
        { type: 'application', pattern: 'src/application/*' },
        { type: 'infrastructure', pattern: 'src/infrastructure/*' },
        { type: 'interface', pattern: 'src/interface/*' },
        { type: 'shared', pattern: 'src/shared/*' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            { from: 'domain', disallow: ['application', 'infrastructure', 'interface', 'shared'] },
            { from: 'application', allow: ['domain', 'infrastructure', 'shared'] },
            { from: 'infrastructure', allow: ['domain', 'infrastructure', 'shared'] },
            { from: 'interface', allow: ['domain', 'infrastructure', 'interface', 'shared'] },
            { from: 'shared', allow: ['domain', 'infrastructure', 'application', 'shared'] },
          ],
        },
      ],
    },
  },
];

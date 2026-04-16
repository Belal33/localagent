# Next.js Config

Next.js 16 config marking native / Node-only packages as external so they are not bundled by Turbopack/Webpack.
Covers `camoufox-js`, `impit`, `playwright-core`, `playwright`, `pg`, `neo4j-driver`.

Defined in `next.config.ts`. Uses the `serverExternalPackages` option to prevent Next's
bundler from trying to browserify native bindings (which would break at build or runtime).
Dev server runs on port 3333 per `package.json` scripts. Running on Next 16.1.6 with
React 19.2.3.

# Publishing

This package publishes to npm as `convex-secret-store`.

Before the first publish:

1. Ensure the npm package name is still available and matches `package.json`.
2. `npm login`
3. `npm ci`
4. `npm run build:clean`
5. `npm run typecheck`
6. `npm run lint`
7. `npm test`
8. `npm pack --dry-run`
9. `npm publish --access public`

## Recommended release flow

The release scripts in `package.json` already chain the important checks:

- `preversion` runs a clean build, tests, lint, and typecheck
- `version` updates `CHANGELOG.md`
- `alpha` publishes a prerelease tagged `alpha`
- `release` publishes the next patch version as `latest`

## Alpha publish

```sh
npm run alpha
```

Install the alpha with:

```sh
npm install convex-secret-store@alpha
```

## Stable publish

```sh
npm run release
```

For a minor or major release:

```sh
npm version minor # or major
npm publish
git push --follow-tags
```

## Sanity-check the tarball

```sh
npm pack
```

Then install the generated tarball in another project:

```sh
npm install ./path/to/convex-secret-store-<version>.tgz
```

Verify:

- `convex-secret-store/convex.config.js` resolves
- `convex-secret-store` exports the `SecretStore` class
- `convex-secret-store/_generated/component.js` exposes component types
- the README snippets still match the published package name

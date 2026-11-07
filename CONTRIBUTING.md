# Developing guide

## Running locally

```sh
npm i
npm run dev
```

## Testing

```sh
npm ci
npm run build:clean
npm run typecheck
npm run lint
npm run test
```

## Release a version

Update `CHANGELOG.md`, then run `npm run release -- patch`. Replace `patch` with
`minor`, `major`, or a specific version as needed. The command creates a local
commit and tag without opening an editor.

The release workflow publishes pushed `v*` tags through npm trusted publishing.
Tags that contain `-` use the `next` dist-tag. Configure the npm trusted
publisher for `.github/workflows/release.yml` before the first release.

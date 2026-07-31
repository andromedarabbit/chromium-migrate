# Contributing to chromium-migrate

Thanks for helping make Chromium profile migration safer and more portable.

## Development setup

```bash
git clone https://github.com/IshankDev/chromium-migrate.git
cd chromium-migrate
npm install
npm run build
npm test
```

Requires **Node.js 22+**.

## Project guidelines

- Prefer extending the **browser registry** (`src/browsers/registry.ts`) over hardcoding paths.
- Never log, print, or write decrypted passwords/cookie values.
- Keep migrators modular — one stage per concern.
- Add unit/integration tests for new behavior.
- Run `npm run typecheck` and `npm test` before opening a PR.

## Adding a browser

1. Add an entry to `BROWSER_REGISTRY` with:
   - `userDataPaths` for darwin/linux/win32 using `{home}` templates
   - `processNames`, optional `bundleIds`
   - `safeStorage` service/account names
2. Document any browser-specific limitations in `notes`.
3. Add a registry unit test for id/alias resolution if you introduce aliases.

## Pull requests

- Keep PRs focused.
- Describe the browsers/platforms you tested.
- Do not commit `logs/`, `backups/`, `reports/`, or real profile data.

## Security

If you find a vulnerability in secret handling, please open a private security advisory on GitHub instead of a public issue when possible.

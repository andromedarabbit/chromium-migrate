# chromium-migrate

Open-source CLI to migrate **Chromium browser profiles** from one browser to another.

Move bookmarks, history, passwords, cookies, extensions, autofill, sessions, permissions, and preferences between browsers such as:

**Chrome · Brave · Arc · Edge · Vivaldi · Opera · Opera GX · Chromium · Thorium · Dia**

> Engine: Chromium profile format · Runtime: Node.js 22+ · License: MIT

---

## Why

Switching browsers usually means re-logging into everything and losing years of profile data. `chromium-migrate` copies Chromium profile databases and JSON, and on supported platforms re-encrypts passwords/cookies for the target browser’s Safe Storage key — without ever writing secrets to disk in plaintext.

---

## Install

```bash
git clone https://github.com/IshankDev/chromium-migrate.git
cd chromium-migrate
npm install
npm run build
npm link   # exposes `chromium-migrate` and `cmigrate`
```

Or run without linking:

```bash
node dist/cli.js <command>
npm run dev -- <command>
```

### Native modules

`better-sqlite3` and `keytar` need a working build toolchain:

```bash
# macOS
xcode-select --install
npm rebuild better-sqlite3 keytar
```

The first password/cookie migration may prompt for OS keychain access — allow it.

---

## Quick start

```bash
# See what browsers/profiles exist
chromium-migrate browsers
chromium-migrate profiles

# Preview (no writes)
chromium-migrate dry-run --from arc --to brave

# Migrate
chromium-migrate migrate --from arc --to brave -y

# Verify
chromium-migrate verify --from arc --to brave

# Rollback target profile
chromium-migrate rollback
```

### Examples

```bash
chromium-migrate migrate --from chrome --to brave -y
chromium-migrate migrate --from brave --to chrome --source-profile "Profile 1"
chromium-migrate migrate --from edge --to vivaldi --no-passwords
chromium-migrate dry-run --from arc --to chrome
```

---

## CLI

| Command | Description |
| --- | --- |
| `migrate` | Migrate profile `--from` → `--to` |
| `verify` | Compare source/target counts |
| `backup create/list` | Snapshot a profile before changes |
| `rollback` | Restore a backup |
| `dry-run` | Estimate without writing |
| `profiles` | Discover installed browser profiles |
| `browsers` | List supported browsers + expected paths |
| `report` | Show generated reports |
| `clean` | Prune old backups/logs |

**Aliases:** `cmigrate`, and legacy `arc2brave` (same binary).

### Common flags

| Flag | Description |
| --- | --- |
| `-f, --from <browser>` | Source browser id |
| `-t, --to <browser>` | Target browser id |
| `--source-profile` / `--target-profile` | Profile folder (default `Default`) |
| `--no-passwords` / `--no-cookies` / … | Skip stages |
| `--skip-backup` | Skip target snapshot |
| `-y, --terminate` | Quit browsers without prompting |
| `-v, --verbose` | Debug logs |

---

## Supported data

| Data | Notes |
| --- | --- |
| Bookmarks | Folders, order, dates; Arc sidebar → bookmarks when source is Arc |
| History / downloads | Full Chromium History DB |
| Passwords | Re-encrypted on macOS (Keychain); copied as-is elsewhere |
| Cookies | Re-encrypted on macOS; Network/Cookies layout handled |
| Autofill | Addresses, form history, masked card metadata |
| Extensions | Packages + local/sync settings |
| Sessions / tabs | Current/Last Session files |
| Permissions | Content-settings exceptions |
| Preferences | Compatible Chromium prefs only |
| Favicons / Top Sites | Databases copied |

### Not portable

Browser-specific UI (Arc Spaces/Boosts, Vivaldi panels, Opera workspaces), cloud sync sessions, full credit-card PANs.

---

## Platform support

| Platform | Profile discovery | DB copy | Password/cookie re-encrypt |
| --- | --- | --- | --- |
| macOS | ✅ | ✅ | ✅ (Keychain + AES-128-CBC) |
| Linux | ✅ | ✅ | ⚠️ experimental via keytar / may copy blobs as-is |
| Windows | ✅ paths | ✅ | ❌ DPAPI not yet implemented (blobs copied as-is) |

Paths are resolved from a **browser registry** using `{home}` templates — nothing is hardcoded to a specific machine or username.

Override data directories with:

```bash
export CHROMIUM_MIGRATE_HOME=/path/to/writable/workdir   # logs/backups/reports
```

---

## Architecture

```
src/
  browsers/     Registry, discovery, process control
  migration/    Stage migrators + orchestrator
  services/     Backup + crypto / Safe Storage
  database/     SQLite helpers (batched, transactional)
  commands/     CLI (commander)
  reports/      JSON / Markdown / HTML
```

Add a browser by editing `src/browsers/registry.ts` — no scattered hardcoding.

---

## Safety

1. Target profile is backed up under `backups/` before mutation (unless `--skip-backup`).
2. Source and target browsers must be closed (`-y` to terminate).
3. Secrets are decrypted only in memory for re-encryption — never logged or written plaintext.
4. `rollback [backupId]` restores the previous target profile.

---

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Issues and PRs welcome — especially new browser definitions, Windows DPAPI support, and Linux secret-service hardening.

---

## License

MIT © contributors

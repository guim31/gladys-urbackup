# UrBackup for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the clients of an [UrBackup](https://www.urbackup.org/) server into
Gladys: whether each computer is online and backed up, and an alert when a
backup fails or a computer was not backed up for too long.

- **One device per client** (a computer backed up): state (OK, failed,
  overdue, running, no backup), online, last file backup and hours since then,
  last image backup and hours since then, backup running, its progress, errors
  of the last backup.
- **One server device**: clients online, backups running, clients failed and
  overdue.
- **Scene triggers**: a backup succeeds, a backup fails (errors in its log), a
  client is overdue (UrBackup no longer marks its file backups OK, or a fixed
  delay) — for any client, added to Gladys or not. Same triggers and actions as
  [gladys-duplicati](https://github.com/guim31/gladys-duplicati) and
  [gladys-kopia](https://github.com/guim31/gladys-kopia).
- **Scene actions**: state of a client (with a ready-made sentence), start an
  incremental file backup (can be disabled in the configuration).
- **Dashboard widget**: failed clients first, then the overdue ones, then the
  others.
- Texts in English, French, German and Spanish.

Tested against a real UrBackup server 2.5 (Docker images
`uroni/urbackup-server` 2.5.37 and `uroni/urbackup-client` 2.5.31): login with
and without users, a backup succeeded, one failed, a backup started from the
integration, a client offline. Not yet tested on a real Gladys: feedback
welcome on [the issues](https://github.com/guim31/gladys-urbackup/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- An UrBackup server whose web interface (port 55414 by default) is reachable
  from the Gladys machine, and a user of that interface: the admin, or a user
  with the rights `status`, `progress`, `lastacts`, `logs` and `start_backup`.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-urbackup`. Then open its configuration,
enter the address of the UrBackup server, the username and the password, and
add the clients from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The container logs in to the web interface of UrBackup (its salted login:
md5, then PBKDF2-SHA256 when the server asks for it, as the web interface does)
and reads the status of the clients, the last activities and the backup logs,
every 5 minutes by default and every 30 seconds while a backup runs. UrBackup
writes a log when a backup ends, with its error count: a new log is a backup
succeeded or failed. The last log seen is kept in `/data`, so a backup that
ended during a restart is announced once. Redirects are not followed, so the
password proof is never sent to another host.

## Limits

- One UrBackup server per configuration.
- The triggers come at the next reading after the end of a backup.
- The integration watches backups and starts incremental file backups; it does
  not restore, delete or configure anything.
- HTTPS only with a certificate signed by a known authority (a reverse proxy).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the
UrBackup API.

## Credits

- [UrBackup](https://github.com/uroni/urbackup_backend) by Martin Raiber
  (AGPL-3.0): the API answers in `test/fixtures/urbackup` come from its Docker
  images. The logo on the cover is the UrBackup logo, from the header of the
  web interface of the server (`www/images/header_new.png`).
- The login follows
  [urbackup-server-python-web-api-wrapper](https://github.com/uroni/urbackup-server-python-web-api-wrapper)
  (Apache-2.0), the library of the Home Assistant integration.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-kopia](https://github.com/guim31/gladys-kopia).

Not affiliated with UrBackup or its authors.

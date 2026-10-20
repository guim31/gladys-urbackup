# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The clients of an UrBackup server in Gladys: one device per client (state,
  online, last file backup and hours since then, last image backup and hours
  since then, backup running, progress, errors of the last backup) and one
  server device (clients online, backups running, clients failed and overdue).
- Scene triggers: a backup succeeds, a backup fails (errors in its log), a
  client is overdue (UrBackup's own verdict, or a fixed delay) — for any
  client, added to Gladys or not, kept across restarts.
- Scene actions: state of a client (with a ready-made sentence), start an
  incremental file backup (can be disabled in the configuration).
- Dashboard widget: failed clients first, then the overdue ones, then the
  others, with a Refresh button.
- The salted login of UrBackup (md5 and PBKDF2), or no login for a server
  without users; "Test the connection"; texts and documentation in English,
  French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-urbackup/commits/main

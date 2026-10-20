# UrBackup

[UrBackup](https://www.urbackup.org/) is a free client/server backup system:
a server backs up the files (and, on Windows, the disk images) of the
computers of your home or office. This integration brings the clients of an
UrBackup server into Gladys: each client (a computer backed up) becomes a
device with its state, whether it is online, its last file and image backups,
the backup running and its progress. Scenes can react when **any** backup
succeeds, fails or is overdue, a dashboard widget lists the failed clients
first, and a scene can start an incremental file backup.

Tested against a real UrBackup server 2.5 (Docker image
`uroni/urbackup-server` 2.5.37, client `uroni/urbackup-client` 2.5.31): login
with and without users, a backup that succeeds, one that fails, a backup
started from the integration, a client offline. Not yet tested on a real
Gladys: feedback welcome on
[the issues](https://github.com/guim31/gladys-urbackup/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- An UrBackup server reachable from the Gladys machine, with its web interface
  (port 55414 by default).
- A user of that web interface (**Settings → Users**): the admin, or better a
  dedicated user with the rights `status`, `progress`, `lastacts`, `logs` and
  `start_backup` (the last one only to start backups from Gladys). A server
  without any user accepts anyone: the integration then works without a
  password, but protect your server.

The integration reads UrBackup every 5 minutes by default (every 30 seconds
while a backup runs): three light requests on your own network.

## Getting started

### 1. Prepare the UrBackup server

In the web interface of UrBackup, **Settings → Users → Create user**: a name
(`gladys` for example), a password, and the rights listed above. With the
admin account, nothing to do.

### 2. Configure the integration

In Gladys, **Integrations → UrBackup → Configuration**:

- **UrBackup address**: `http://192.168.1.2:55414` for example. A bare address
  (`192.168.1.2`) means `http://` on port 55414; an address copied from the
  browser works too. Behind a reverse proxy, its `https://` address (with a
  valid certificate).
- **Username** and **Password**: the user of the web interface.
- **Refresh interval**: 1, 5 (default) or 15 minutes.
- **Overdue after**: when a client without a successful backup becomes
  overdue. _Automatic_ (default) follows UrBackup: a client is overdue when
  UrBackup no longer marks its file backups OK (no backup within the interval
  of its settings, the incremental one by default). Or a fixed delay, from 12
  hours to a week, since its last successful backup, file or image.
- **Allow starting backups**: lets the scene action "Start a file backup" work.
  Disable it if nobody should start a backup from Gladys.
- **Language of the names**: language of the feature names, of the states and
  of the scene results.

**Test the connection** reads UrBackup and sums up: the number of clients,
online, failed and overdue.

### 3. Add the clients

In the **Discover** tab, add the clients to follow, and the "UrBackup" device
for the server. Scene triggers work for every client, added or not.

## The devices

Each client:

| Feature                       | Value                                        |
| ----------------------------- | -------------------------------------------- |
| State                         | OK, Failed, Overdue, Running or No backup    |
| Online                        | 1 when the client is connected to the server |
| Last file backup              | day/month hours:minutes, "-" if none         |
| Hours since last file backup  | in hours                                     |
| Last image backup             | day/month hours:minutes, "-" if none         |
| Hours since last image backup | in hours                                     |
| Backup running                | 1 while a backup of this client runs         |
| Progress                      | in %, of the backup running                  |
| Errors of the last backup     | errors in the log of its last backup         |

The "UrBackup" device, for the server, counts:

- **Clients online**;
- **Backups running**;
- **Failed clients**;
- **Overdue clients**.

A backup "fails" when its log holds errors: a backup that UrBackup could not
complete, or that ended with errors. A client offline gets the "unreachable"
badge in Gladys. The state shows what needs attention first: a failed client
shows "Failed" even when it is also overdue.

## Dashboard

The **UrBackup** widget shows the number of clients failed, overdue and
online, then one row per client: failed first, then overdue, running, without
backup, OK, with the last backup (or the progress of the one running); an OK
client offline is grey. Every client by default, or the ones chosen in its
settings. The **Refresh** button reads UrBackup again.

## Scenes

### Triggers

- **A backup succeeds**: a backup (files or image) ends without error.
  Information: client, kind (files, image), duration (minutes), size
  transferred.
- **A backup fails**: a backup ends with errors in its log. Information:
  client, kind, first error, errors.
- **A client is overdue**: a client has had no successful backup for longer
  than the "Overdue after" delay. Once, again after a new success.
  Information: client, hours since last success, last success.

Each trigger can be limited to some clients (empty: any).

### Actions

- **State of a client**: reads the state of a client for the next actions:
  failed, overdue, online, the state in words, the client, the last success,
  hours since last success (-1 if none), and a ready-made sentence
  ("laptop-anna: Failed, last backup 18/10 02:05.").
- **Start a file backup**: starts an incremental file backup of the client
  now. Refused when "Allow starting backups" is disabled, or by UrBackup when
  the client is offline.

### Scene ideas

- **A backup fails** → send a message with the client and its first error,
  picked from the information of the trigger.
- **A client is overdue** → notify with the client and the hours since its
  last success: the laptop was not switched on for days.
- Every Sunday at 10:00 → **State of a client** → send the sentence; or start
  a file backup of the office computer at 19:00 with **Start a file backup**.

## Troubleshooting

- **"UrBackup does not answer"**: check the address and the port from the
  Gladys machine (`http://…:55414`, the port of the web interface, not 55413
  or 55415).
- **"username or password refused by UrBackup"**: type them again; they are
  the ones of a user of the web interface.
- **"this UrBackup user lacks a right"**: give the user the rights `status`,
  `progress`, `lastacts`, `logs` (and `start_backup`). Without `logs`, the
  states still show but no backup succeeded or failed is announced.
- **"UrBackup did not start the backup"**: the client is offline, or a backup
  of it already runs.
- **"UrBackup is upgrading its database"**: after an update of UrBackup; wait
  until it is done.
- **A client never becomes overdue**: in _Automatic_, a client whose file
  backups are disabled, or never backed up, is not overdue; choose a fixed
  delay for the image backups.
- To see more, set the `LOG_LEVEL` variable of the integration to `debug`.

## Limits

- One UrBackup server per integration.
- A backup is known when it ends, by its log: the triggers come at the next
  reading (5 minutes by default).
- The integration does not restore, delete or configure backups: it watches
  them, and starts incremental file backups if allowed.
- HTTPS only with a certificate signed by a known authority (a reverse proxy).
- Not affiliated with UrBackup. Report a problem or an idea on
  [the issues](https://github.com/guim31/gladys-urbackup/issues).

# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **username and password of a user of the UrBackup web interface**,
  stored by Gladys in the integration configuration (never written to `/data`,
  never logged). The password itself is never sent: the login sends a proof
  computed from it and from the salt and the random value the server gives
  (md5, PBKDF2-SHA256), only to the address configured; redirects are not
  followed;
- the **session** of the web interface: kept in memory only, opened again when
  the server restarts;
- `/data/urbackup-state.json`: the address of the server, the id of the last
  backup log seen, and for each client (its id on the server) its last backup
  result, first error included, and whether it was overdue (no secret);
- network: HTTP(S) requests to the UrBackup address, nothing else; no port is
  opened. The integration can start an incremental file backup (when allowed
  in its configuration), never delete, restore or configure one. A dedicated
  UrBackup user with only the rights it needs is recommended.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and UrBackup itself.

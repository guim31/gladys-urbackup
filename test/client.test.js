// -----------------------------------------------------------------------------
// The UrBackup client: the real answers of UrBackup 2.5.37
// (test/fixtures/urbackup, anonymized) normalized, and the login, the session
// and the errors against the fake server.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ERROR_KINDS,
  UrBackupClient,
  firstError,
  normalizeActivities,
  normalizeLogs,
  normalizeStatus,
  passwordProof,
} from '../src/urbackup/client.js';
import { BASE, FakeUrBackup, PASSWORD, USERNAME } from './helpers/fakeUrBackup.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/urbackup/${name}`, import.meta.url), 'utf8'));

const client = (fake, extra = {}) =>
  new UrBackupClient({
    url: BASE,
    username: USERNAME,
    password: PASSWORD,
    request: fake.request,
    ...extra,
  });

test('the status of a real server: a client backed up, one never seen', async () => {
  const { version, clients } = normalizeStatus(await fixture('status-idle.json'));
  assert.equal(version, '2.5.37');
  assert.deepEqual(
    clients.map(({ id, name, online, fileOk, running }) => ({ id, name, online, fileOk, running })),
    [
      { id: '1', name: 'laptop-anna', online: true, fileOk: true, running: false },
      { id: '2', name: 'nas-bob', online: false, fileOk: false, running: false },
    ],
  );
  assert.equal(clients[0].lastFile, 1792490480 * 1000);
  assert.equal(clients[0].lastImage, null, 'lastbackup_image 0: never');
  assert.equal(clients[0].imageEnabled, false, 'image_not_supported on Linux');
  assert.equal(clients[1].lastFile, null);
});

test('a backup running: the process of the client, its progress', async () => {
  const { clients } = normalizeStatus(await fixture('status-running.json'));
  assert.equal(clients[0].running, true);
  assert.equal(clients[0].progress, 0);
  assert.equal(clients[0].runningImage, false);
});

test('the logs, oldest first, with their errors; the first error of a failed one', async () => {
  const logs = normalizeLogs(await fixture('logs.json'));
  assert.deepEqual(
    logs.map(({ id, errors }) => [id, errors]),
    [
      [1, 0],
      [2, 0],
      [3, 2],
      [4, 0],
      [5, 0],
    ],
  );
  assert.equal(logs[2].name, 'laptop-anna');
  assert.equal(
    firstError(await fixture('log-failed.json')),
    'Cannot create directory /backups/laptop-anna/261020-0950 for backup (server error). File exists (code: 17)',
  );
  assert.equal(firstError({ log: { data: '2-1-Backup failed\n' } }), 'Backup failed');
  assert.equal(firstError({}), '');
  assert.equal(normalizeLogs({ all_clients: false }), null, 'no log right');
});

test('the last activities: duration in seconds, size transferred', async () => {
  const [last] = normalizeActivities(await fixture('progress-idle.json'));
  assert.equal(last.clientId, '1');
  assert.equal(last.image, false);
  assert.equal(typeof last.durationS, 'number');
  assert.ok(last.sizeBytes >= 0);
});

test('the password proof: md5(salt + password), PBKDF2-SHA256, then md5(rnd + hex)', () => {
  const salt = { salt: 'abcdefghij0123456789', rnd: 'm7xTXir3YR', pbkdf2_rounds: 10000 };
  // Computed with the algorithm of urbackup-server-web-api-wrapper (Python
  // hashlib) for the same inputs; this one was accepted by the real server.
  assert.equal(passwordProof('test-pass', salt), 'bc9b6402d81c3786c2f8567a0c20cdd7');
  // An older server, without rounds: md5 only.
  assert.equal(
    passwordProof('test-pass', { ...salt, pbkdf2_rounds: 0 }),
    '00aaca150e6ffe73505d25a4f51bea8e',
  );
});

test('login with salt, then the session; a server restart opens a new one', async () => {
  const fake = new FakeUrBackup();
  fake.add('laptop-anna');
  const urbackup = client(fake);
  assert.equal((await urbackup.status()).clients.length, 1);
  assert.deepEqual(fake.calls, ['login', 'salt', 'login', 'status']);
  fake.calls = [];
  await urbackup.status();
  assert.deepEqual(fake.calls, ['status'], 'the session is kept');
  fake.restart();
  fake.calls = [];
  await urbackup.status();
  assert.deepEqual(fake.calls, ['status', 'login', 'salt', 'login', 'status']);
});

test('a server without users: the anonymous login', async () => {
  const fake = new FakeUrBackup({ anonymous: true });
  fake.add('laptop-anna');
  await client(fake, { username: '', password: '' }).status();
  assert.deepEqual(fake.calls, ['login', 'status']);
});

test('the errors: password, user, no answer, not UrBackup, redirect, upgrade, start refused', async () => {
  const fake = new FakeUrBackup();
  fake.add('laptop-anna', { online: false });
  const kind = async (promise) => {
    try {
      await promise;
    } catch (err) {
      return err.kind;
    }
    return 'none';
  };
  assert.equal(await kind(client(fake, { password: 'wrong' }).status()), ERROR_KINDS.AUTH);
  assert.equal(await kind(client(fake, { username: 'nobody' }).status()), ERROR_KINDS.AUTH);
  assert.equal(await kind(client(fake, { username: '' }).status()), ERROR_KINDS.AUTH);
  assert.equal(await kind(client(fake).startBackup('1')), ERROR_KINDS.START_REFUSED);
  fake.down = true;
  assert.equal(await kind(client(fake).status()), ERROR_KINDS.UNREACHABLE);
  const answer = (response) => client({ request: async () => response });
  assert.equal(
    await kind(answer({ status: 200, body: '<html></html>' }).status()),
    ERROR_KINDS.NOT_URBACKUP,
  );
  assert.equal(await kind(answer({ status: 404, body: '' }).status()), ERROR_KINDS.NOT_URBACKUP);
  assert.equal(await kind(answer({ status: 301, body: '' }).status()), ERROR_KINDS.REDIRECT);
  assert.equal(await kind(answer({ status: 500, body: '' }).status()), ERROR_KINDS.HTTP);
  assert.equal(
    await kind(
      answer({ status: 200, body: '{"api_version":2,"upgrading_database":true}' }).status(),
    ),
    ERROR_KINDS.UPGRADING,
  );
});

test('the answers of a real server to a wrong password and an unknown user', async () => {
  // Recorded: login → {"api_version":2,"error":2}; salt of an unknown user → a session, no salt.
  assert.deepEqual(await fixture('login-wrong.json'), { api_version: 2, error: 2 });
  assert.equal((await fixture('salt-unknown.json')).salt, undefined);
  assert.deepEqual(await fixture('session-refused.json'), { error: 1 });
  assert.equal((await fixture('start-backup.json')).result[0].start_ok, true);
});

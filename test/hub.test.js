// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake UrBackup server: discovery,
// states, scene events on backups and overdue clients, persistence across
// restarts, a backup running, the start action, errors, quiet logs, the
// widget and the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS, SERVER_KEYS, serverIds } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  BASE,
  FakeUrBackup,
  HOUR,
  PASSWORD,
  START,
  USERNAME,
  createClock,
  createDevices,
  createWorld,
  idsOf,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const state = (world, name, key) => world.fake.lastState(idsOf(world, name).feature(key));
const server = (world, key) => world.fake.lastState(serverIds(world.gladys).feature(key));
const config = (extra = {}) => ({
  url: BASE,
  username: USERNAME,
  password: PASSWORD,
  language: 'en',
  ...extra,
});

test('one device per client and one for the server, proposed in Discovery, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['UrBackup', 'laptop-anna', 'desktop-bob', 'nas'],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  // Nothing is published for devices not added, and the first read fires nothing.
  assert.equal(world.fake.states.length, 0);
  assert.equal(world.fake.sceneEvents.length, 0);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states of the added devices: backed up, failed, never backed up and offline', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.STATE), 'OK');
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.ONLINE), 1);
  // The activity started 420 s before the log of its end: 8 hours.
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.HOURS_FILE), 8);
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.LAST_IMAGE), '-');
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.HOURS_IMAGE), undefined);
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.ERRORS), 0);
  assert.equal(state(world, 'desktop-bob', FEATURE_KEYS.STATE), 'Failed');
  assert.equal(state(world, 'desktop-bob', FEATURE_KEYS.ERRORS), 2);
  assert.equal(state(world, 'desktop-bob', FEATURE_KEYS.HOURS_FILE), 26);
  assert.equal(state(world, 'nas', FEATURE_KEYS.STATE), 'No backup');
  assert.equal(state(world, 'nas', FEATURE_KEYS.ONLINE), 0);
  assert.equal(state(world, 'nas', FEATURE_KEYS.LAST_FILE), '-');
  assert.equal(server(world, SERVER_KEYS.ONLINE), 2);
  assert.equal(server(world, SERVER_KEYS.RUNNING), 0);
  assert.equal(server(world, SERVER_KEYS.FAILED), 1);
  // desktop-bob: UrBackup says its file backups are not OK, but it failed first.
  assert.equal(server(world, SERVER_KEYS.OVERDUE), 1);
  // The offline client has the unreachable badge, the others the local one.
  const badge = (name) =>
    world.fake.transports.findLast(
      (entry) => entry.device_external_id === idsOf(world, name).device,
    )?.transport;
  assert.equal(badge('nas'), 'unreachable');
  assert.equal(badge('laptop-anna'), 'local');
});

test('a backup that ends fires "succeeded" or "failed", once, with its details', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.clock.advance(HOUR);
  world.urbackup.backup('laptop-anna', 'success', {
    end: world.clock.time,
    seconds: 300,
    size: 2_500_000,
  });
  world.urbackup.backup('nas', 'error', { end: world.clock.time, errors: 3 });
  await world.hub.pollNow();
  const [success] = events(world, TRIGGERS.SUCCEEDED);
  assert.deepEqual(success.data, {
    device: idsOf(world, 'laptop-anna').device,
    client: 'laptop-anna',
    kind: 'files',
    duration_minutes: 5,
    size: '2.5 MB',
  });
  const [failure] = events(world, TRIGGERS.FAILED);
  assert.deepEqual(failure.data, {
    device: idsOf(world, 'nas').device,
    client: 'nas',
    kind: 'files',
    message: 'Cannot read the folder /home/anna (code: 2)',
    errors: 3,
  });
  await world.hub.pollNow();
  assert.equal(world.fake.sceneEvents.length, 2, 'nothing twice');
  // An image backup.
  world.urbackup.backup('desktop-bob', 'success', { end: world.clock.time, image: true });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SUCCEEDED).at(-1).data.kind, 'image');
});

test('a client becomes overdue once (UrBackup says it is not OK), and back when it succeeds', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.urbackup.get('laptop-anna').fileOk = false;
  await world.hub.pollNow();
  await world.hub.pollNow();
  const overdue = events(world, TRIGGERS.OVERDUE);
  assert.equal(overdue.length, 1, 'desktop-bob was already overdue at the first read');
  assert.equal(overdue[0].data.client, 'laptop-anna');
  assert.equal(overdue[0].data.hours_since_success, 8);
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.STATE), 'Overdue');
  world.urbackup.backup('laptop-anna', 'success', { end: world.clock.time });
  await world.hub.pollNow();
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.STATE), 'OK');
});

test('a fixed "Overdue after": hours since the last backup, file or image', async (t) => {
  const world = await createWorld({ config: config({ overdue_hours: '24' }) });
  t.after(() => world.app.stop());
  assert.equal(world.hub.clients.get('1').overdue, false, '8 hours');
  assert.equal(world.hub.clients.get('2').overdue, true, '26 hours');
  assert.equal(world.hub.clients.get('3').overdue, false, 'never backed up');
  // A new threshold is not an event.
  await world.fake.configUpdated(config({ overdue_hours: '12' }));
  world.clock.advance(5 * HOUR);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.OVERDUE).length, 1, 'laptop-anna, 13 hours');
});

test('a backup ended while the integration was stopped is announced after a restart, once', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  first.urbackup.backup('laptop-anna', 'error', { end: START + HOUR });
  const clock = createClock(START + 2 * HOUR);
  const second = await createWorld({ clock, urbackup: first.urbackup, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(events(second, TRIGGERS.FAILED).length, 1);
  await second.app.stop();
  const third = await createWorld({ clock, urbackup: first.urbackup, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.equal(third.fake.sceneEvents.length, 0);
  // Its last backup failed: still failed after the restart.
  assert.equal(third.hub.clients.get('1').lastRun.result, 'error');
});

test('another or reinstalled server (log ids going back) only records', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.urbackup.logs = world.urbackup.logs.slice(0, 1);
  await world.hub.pollNow();
  world.urbackup.backup('laptop-anna', 'success', { end: world.clock.time });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SUCCEEDED).length, 1, 'the new backup after it');
});

test('a backup running: the client and the server show it and its progress; then its end', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.urbackup.get('laptop-anna').processes = [{ action: 1, pcdone: 42 }];
  await world.hub.pollNow();
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.STATE), 'Running');
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.RUNNING), 1);
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.PROGRESS), 42);
  assert.equal(server(world, SERVER_KEYS.RUNNING), 1);
  assert.equal(world.hub.running, true);
  world.urbackup.backup('laptop-anna', 'success', { end: world.clock.time });
  await world.hub.pollNow();
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.RUNNING), 0);
  assert.equal(state(world, 'laptop-anna', FEATURE_KEYS.PROGRESS), 0);
  assert.equal(events(world, TRIGGERS.SUCCEEDED).length, 1);
});

test('"Start a file backup" starts an incremental file backup, unless disabled or offline', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const start = (name) =>
    world.fake.sceneAction('start_backup', { device: idsOf(world, name).device });
  const ack = await start('laptop-anna');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(world.urbackup.started, { id: 1, type: 'incr_file' });
  const offline = await start('nas');
  assert.equal(offline.success, false);
  assert.match(offline.error, /did not start the backup/);
  await world.fake.configUpdated(config({ allow_start: false }));
  const disabled = await start('laptop-anna');
  assert.equal(disabled.success, false);
  assert.match(disabled.error, /disabled in the configuration/);
  const unknown = await world.fake.sceneAction('start_backup', { device: 'nothing' });
  assert.match(unknown.error, /not an UrBackup client/);
});

test('"State of a client" gives a sentence in the language of the configuration', async (t) => {
  const world = await createWorld({ config: config({ language: 'fr' }) });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, 'desktop-bob').device,
  });
  assert.equal(ack.success, true, ack.error);
  const outputs = ack.data.outputs;
  assert.equal(outputs.failed, true);
  assert.equal(outputs.online, true);
  assert.equal(outputs.state, 'En échec');
  assert.equal(outputs.hours_since_success, 26);
  assert.match(
    outputs.sentence,
    /^desktop-bob : En échec, dernière sauvegarde \d\d\/\d\d \d\d:\d\d\.$/,
  );
  const never = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, 'nas').device,
  });
  assert.equal(never.data.outputs.hours_since_success, -1);
  assert.match(never.data.outputs.sentence, /jamais sauvegardé/);
});

test('UrBackup down, wrong password, no configuration: a status, the badge, no crash', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.urbackup.down = true;
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  const badge = world.fake.transports.findLast(
    (entry) => entry.device_external_id === serverIds(world.gladys).device,
  );
  assert.equal(badge.transport, 'unreachable');
  const action = await world.fake.sceneAction('get_backup_status', {
    device: idsOf(world, 'laptop-anna').device,
  });
  assert.equal(action.success, false);
  world.urbackup.down = false;
  await world.hub.pollNow();
  assert.equal(world.fake.connectionStatus.connected, true);

  await world.fake.configUpdated(config({ password: 'wrong' }));
  assert.match(world.fake.connectionStatus.message.en, /password refused/);
  await world.fake.configUpdated(config({ url: 'ftp://nope' }));
  assert.match(world.fake.connectionStatus.message.en, /Address not understood/);
  await world.fake.configUpdated({ url: '', language: 'en' });
  assert.match(world.fake.connectionStatus.message.en, /address of your UrBackup/);
  const report = await world.fake.action('test_connection', {});
  assert.equal(report.success, true);
});

test('a user without the logs right: states still, no backup event, said once', async (t) => {
  const urbackup = new FakeUrBackup();
  urbackup.add('laptop-anna', { lastFile: START - HOUR });
  urbackup.logRight = false;
  const world = await createWorld({ urbackup });
  t.after(() => world.app.stop());
  assert.equal(world.hub.noLogs, true);
  assert.equal(world.hub.clients.get('1').lastSuccess, START - HOUR);
  const report = await world.fake.action('test_connection', {});
  assert.match(report.data?.message?.en ?? JSON.stringify(report), /lacks a right/);
});

test('"Test the connection" sums up the server', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const report = await world.hub.testConnection();
  assert.equal(report.en, 'UrBackup: Connected, 3 client(s), 2 online, 1 failed, 1 overdue');
  assert.equal(report.fr, 'UrBackup : Connecté, 3 client(s), 2 en ligne, 1 en échec, 1 en retard');
});

test('the widget: valid content, failed first, then the others', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language });
    assert.equal(ack.success, true, ack.error);
    validateWidgetContent(ack.data.content);
  }
  const { data } = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  const rows = data.content.components.find((component) => component.type === 'status').items;
  assert.deepEqual(
    rows.map((row) => row.label),
    ['desktop-bob', 'nas', 'laptop-anna'],
  );
  assert.match(rows[0].value, /^Failed · /);
  // The ones chosen in the settings only.
  const chosen = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { clients: [idsOf(world, 'nas').device] },
    language: 'en',
  });
  const items = chosen.data.content.components.find(
    (component) => component.type === 'status',
  ).items;
  assert.deepEqual(
    items.map((row) => row.label),
    ['nas'],
  );
  const action = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {}, { language: 'en' });
  assert.equal(action.success, true, action.error);
  // UrBackup down: the error in words.
  world.urbackup.down = true;
  await world.hub.pollNow();
  const down = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  validateWidgetContent(down.data.content);
  assert.ok(
    down.data.content.components.some((c) => c.type === 'text' && /does not answer/.test(c.text)),
  );
});

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('a normal reading cycle writes nothing at the info level, nor the password', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      world.clock.advance(5 * 60_000);
      await world.hub.pollNow();
    }
    world.urbackup.restart(); // a new session, silently
    await world.hub.pollNow();
  });
  assert.ok(world.fake.states.length >= sent);
  assert.ok(!lines.join('\n').includes(PASSWORD));
  assert.deepEqual(lines, []);
});

test('the internal timer reads UrBackup, every 30 seconds while a backup runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const urbackup = new FakeUrBackup();
  urbackup.add('laptop-anna');
  urbackup.get('laptop-anna').processes = [{ action: 1, pcdone: 10 }];
  const world = await createWorld({ urbackup, timers: true });
  t.after(() => world.app.stop());
  const reads = () => urbackup.calls.filter((call) => call === 'status').length;
  const before = reads();
  t.mock.timers.tick(30_000);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(reads(), before + 1);
});

test('review fixes: overdue threshold with new credentials, old logs, removed client, start grace', async (t) => {
  // A new password and a new threshold in one save: no overdue event.
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated(
    config({ password: PASSWORD, username: USERNAME, overdue_hours: '24', poll_interval: '60' }),
  );
  await world.fake.configUpdated(config({ overdue_hours: '12', username: 'admin ' }));
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.OVERDUE).length, 0);

  // A backup that ended two days ago, found after an outage: recorded silently.
  world.urbackup.backup('laptop-anna', 'error', { end: world.clock.time - 48 * HOUR });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FAILED).length, 0);
  assert.equal(world.hub.clients.get('1').lastRun.result, 'error');

  // A client removed from UrBackup: said so.
  const nas = idsOf(world, 'nas').device;
  world.urbackup.clients.delete(3);
  world.clock.advance(60_000);
  const gone = await world.fake.sceneAction('get_backup_status', { device: nas });
  assert.match(gone.error, /no longer exists/);

  // Just after a start, the 30-second cadence, before UrBackup shows it running.
  world.urbackup.get('laptop-anna').processes = [];
  await world.hub.startBackup(world.hub.clients.get('1'));
  world.urbackup.get('laptop-anna').processes = [];
  await world.hub.pollNow();
  assert.equal(world.hub.running, true);
  world.clock.advance(3 * 60_000);
  assert.equal(world.hub.running, false);
});

test('a non-admin user without the status right: an empty list is a right missing', async (t) => {
  const urbackup = new FakeUrBackup();
  urbackup.admin = undefined;
  const world = await createWorld({ urbackup });
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.en, /lacks a right/);
});

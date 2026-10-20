// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake UrBackup server, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs: the tests read UrBackup with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-kopia.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { clientIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { BASE, FakeUrBackup, PASSWORD, USERNAME } from './fakeUrBackup.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const HOUR = 3_600_000;
export const START = Date.UTC(2026, 9, 19, 10, 0, 0);

/** A manual clock, shared by the hub, the fake and the tests. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * The default server: a laptop backed up 8 hours ago, a desktop whose last
 * backup failed 2 hours ago (last success 26 hours ago, so UrBackup says it
 * is not OK), a NAS never backed up and offline.
 */
export function defaultUrBackup(now = START) {
  const fake = new FakeUrBackup();
  fake.add('laptop-anna');
  fake.backup('laptop-anna', 'success', { end: now - 32 * HOUR });
  fake.backup('laptop-anna', 'success', { end: now - 8 * HOUR, seconds: 420, size: 1_234_567_890 });
  fake.add('desktop-bob', { imageNotSupported: false });
  fake.backup('desktop-bob', 'success', { end: now - 26 * HOUR });
  fake.backup('desktop-bob', 'error', { end: now - 2 * HOUR });
  fake.get('desktop-bob').fileOk = false;
  fake.add('nas', { online: false });
  return fake;
}

export async function createWorld({
  clock = createClock(),
  urbackup = defaultUrBackup(clock.time),
  config = { url: BASE, username: USERNAME, password: PASSWORD, language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-urbackup-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: urbackup.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, urbackup, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of a client of the fake, by name. */
export const idsOf = (world, name) => clientIds(world.gladys, String(world.urbackup.get(name).id));

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { BASE, FakeUrBackup, PASSWORD, USERNAME };

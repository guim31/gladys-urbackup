// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of UrBackup 2.5.37 (test/fixtures/urbackup: a client backed up,
// with a failed backup in its logs, and a client never backed up; the server
// idle and running a backup), in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const fixture = (name) => readFile(new URL(`./fixtures/urbackup/${name}`, import.meta.url), 'utf8');

/** A request seam answering with the real fixtures, behind the salted login. */
async function realServer(running) {
  const files = {
    status: await fixture(running ? 'status-running.json' : 'status-idle.json'),
    progress: await fixture(running ? 'progress-running.json' : 'progress-idle.json'),
    logs: await fixture('logs.json'),
  };
  return async (url, { body }) => {
    const action = new URL(url).searchParams.get('a');
    const params = new URLSearchParams(body);
    if (action === 'login') {
      return {
        status: 200,
        body: params.get('password')
          ? '{"success":true}'
          : await fixture('login-anonymous-refused.json'),
      };
    }
    if (action === 'salt') {
      return { status: 200, body: await fixture('salt.json') };
    }
    if (action === 'logs' && params.get('logid')) {
      return { status: 200, body: await fixture('log-failed.json') };
    }
    return { status: 200, body: files[action] ?? '{}' };
  };
}

async function discover(language, running) {
  const gladys = createFakeGladys({
    config: { url: 'http://192.0.2.10:55414', password: 'x', language },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-urbackup-rules-'))),
    timers: false,
    request: await realServer(running),
  });
  await gladys.connect();
  await app.ready;
  // Every device added: its states must be accepted too.
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await app.stop();
  return { devices: gladys.fake.discoveredDevices, states: gladys.fake.states };
}

const scenarios = [
  { label: 'idle, English names', language: 'en', running: false },
  { label: 'running, French names', language: 'fr', running: true },
  { label: 'idle, German names', language: 'de', running: false },
  { label: 'running, Spanish names', language: 'es', running: true },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { devices, states } = await discover(scenario.language, scenario.running);
    // The two clients of the fixture and the server.
    assert.equal(devices.length, 3, 'the clients and the server');
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }

    // Every state lands on a declared feature, within its bounds.
    const features = new Map(
      devices.flatMap((device) => device.features).map((f) => [f.external_id, f]),
    );
    assert.ok(states.length > 0);
    for (const state of states) {
      const feature = features.get(state.device_feature_external_id);
      assert.ok(feature, `${state.device_feature_external_id}: unknown feature`);
      if (feature.type === 'text') {
        assert.ok(typeof state.text === 'string' && state.text.length > 0, `${feature.name}: text`);
      } else {
        assert.ok(
          state.state >= feature.min && state.state <= feature.max,
          `${feature.name}: ${state.state} out of [${feature.min}, ${feature.max}]`,
        );
      }
    }
  });
}

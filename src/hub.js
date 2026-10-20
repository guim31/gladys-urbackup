// -----------------------------------------------------------------------------
// The UrBackup hub: the server read on a timer of the container (the interval
// chosen in the configuration, 30 seconds while a backup runs, for its
// progress); the states of the added devices published when they change, the
// scene events fired on the backups and on the overdue clients, and the views
// the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 15 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every client, added to Gladys or not — "a backup
// fails" spares the user one scene per device.
//
// A backup is known by its log: UrBackup writes one when a backup ends (none
// while it runs), with its error count. The last log seen is kept in /data
// (src/store.js): a backup that ended while the integration or Gladys
// restarted is still announced, once.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildClientDevice,
  buildServerDevice,
  clientIds,
  clientValues,
  hoursSince,
  isOverdue,
  parseClientId,
  serverIds,
  serverValues,
  stateOf,
} from './devices.js';
import { ERROR_KINDS, UrBackupClient, UrBackupError } from './urbackup/client.js';
import { hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  KIND_TEXT,
  REPORT_TEXT,
  formatTime,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'urbackup-hub' });

export const WIDGET_KEY = 'urbackup';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
// The same as guim31/gladys-duplicati and gladys-kopia, so that scenes read alike.
export const TRIGGERS = Object.freeze({
  SUCCEEDED: 'backup_succeeded',
  FAILED: 'backup_failed',
  OVERDUE: 'backup_overdue',
});

export const HUB_TIMINGS = {
  // While a backup runs: its progress and its end, read this often.
  runningPollMs: 30_000,
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads UrBackup again when the last read is older.
  freshMs: 15_000,
  // After a start from Gladys, read every 30 seconds this long, until it runs.
  startGraceMs: 120_000,
  // A backup log older than this, found after an outage, is recorded silently.
  announceWithinMs: 24 * 3600_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;

/** "1.2 GB", for a scene message. */
export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** The view of a client: what the status says, its last backup (from the logs), overdue or not. */
export function viewOf(client, lastRun, { now, overdueHours }) {
  const times = [client.lastFile, client.lastImage].filter((time) => time !== null);
  const view = {
    ...client,
    lastRun,
    lastSuccess: times.length > 0 ? Math.max(...times) : null,
  };
  view.overdue = isOverdue(view, overdueHours, now);
  return view;
}

export class UrBackupHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/urbackup/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} views of the clients of the last read, by id */
    this.clients = new Map();
    this.readAt = 0;
    this.error = null;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { lastLogId: null, clients: {} };
    this.noLogs = false;
    this.startedUntil = 0;
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  get running() {
    // Just after a start from Gladys too: UrBackup takes a moment to begin.
    return (
      this.now() < this.startedUntil || [...this.clients.values()].some((client) => client.running)
    );
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      url: typeof saved?.url === 'string' ? saved.url : null,
      lastLogId: Number.isInteger(saved?.lastLogId) ? saved.lastLogId : null,
      clients: saved?.clients && typeof saved.clients === 'object' ? saved.clients : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.signature !== null && this.config.language !== config.language;
    // Before a new server or password resets the read below.
    const hadRead = this.readAt !== 0;
    const overdueChanged = this.config.overdueHours !== config.overdueHours;
    this.config = config;
    const signature = JSON.stringify([config.url, config.username, config.password]);
    if (signature !== this.signature) {
      if (config.url && this.saved.url !== config.url) {
        // Another server: what was seen of the previous one means nothing here.
        this.saved = { url: config.url, lastLogId: null, clients: {} };
        this.store.save(this.saved);
      }
      this.signature = signature;
      this.client = config.url
        ? new UrBackupClient({
            url: config.url,
            username: config.username,
            password: config.password,
            request: this.request,
          })
        : null;
      this.clients = new Map();
      this.readAt = 0;
      this.error = null;
      this.polling = null;
    }
    if (languageChanged) {
      this.discovered = null; // new names for the Discovery tab
    }
    if (overdueChanged && hadRead) {
      // A new threshold is not an event: the clients overdue by it are only recorded.
      for (const saved of Object.values(this.saved.clients)) {
        saved.overdue = null;
      }
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    const delay = this.running ? this.timings.runningPollMs : this.config.pollIntervalMs;
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading UrBackup works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, delay);
  }

  // --- Reading UrBackup ---------------------------------------------------------

  /** Read the server now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read the server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let snapshot;
    try {
      snapshot = await this.fetch(client);
    } catch (err) {
      if (!(err instanceof UrBackupError)) {
        throw err;
      }
      if (client !== this.client) {
        return false;
      }
      return this.applyFailure(err);
    }
    return client === this.client && this.applySuccess(client, snapshot);
  }

  /** Everything UrBackup says: clients, last activities, logs. */
  async fetch(client) {
    const { version, clients } = await client.status();
    const activities = await client.activities();
    const logs = await client.logs();
    return { version, clients, activities, logs };
  }

  async applySuccess(client, { version, clients, activities, logs }) {
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error) {
      logger.info('UrBackup answers again');
    }
    if (this.readAt === 0) {
      logger.info(
        `UrBackup ${version ?? ''} (${hostOf(this.config.url)}): ${clients.length} client(s)`,
      );
    }
    if (logs === null && !this.noLogs) {
      logger.warn('This UrBackup user may not read the logs: backups succeeded or failed unknown');
    }
    this.noLogs = logs === null;
    this.error = null;
    const now = this.now();
    this.readAt = now;

    let dirty = false;
    const byName = new Map(clients.map((item) => [item.name, item.id]));
    const runs = await this.newRuns(client, logs ?? [], byName);
    if (runs.dirty) {
      dirty = true;
    }

    const next = new Map();
    for (const item of clients) {
      const saved = this.saved.clients[item.id];
      const fresh = runs.byClient.get(item.id);
      const lastRun = fresh?.at(-1) ?? saved?.run ?? null;
      const view = viewOf(item, lastRun, { now, overdueHours: this.config.overdueHours });
      next.set(item.id, view);
      const previous = this.clients.get(item.id);
      if (
        !previous ||
        stateOf(previous) !== stateOf(view) ||
        previous.name !== view.name ||
        previous.online !== view.online ||
        previous.lastSuccess !== view.lastSuccess ||
        (view.running && previous.progress !== view.progress)
      ) {
        widgetChanged = true;
      }
      dirty = (await this.transition(view, fresh ?? [], activities)) || dirty;
    }
    if ([...this.clients.keys()].some((id) => !next.has(id))) {
      widgetChanged = true; // a client removed
    }
    this.clients = next;
    // A client removed from UrBackup is forgotten.
    for (const id of Object.keys(this.saved.clients)) {
      if (!next.has(id)) {
        delete this.saved.clients[id];
        dirty = true;
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.saved.url = this.config.url;
      this.store.save(this.saved);
    }
    await this.publishStates();
    return widgetChanged;
  }

  /**
   * The backups ended since the last read: the logs newer than the last one
   * seen, by client. The first read only records where the logs stand. A log
   * id lower than the one kept means another (or a reinstalled) server.
   */
  async newRuns(client, logs, byName) {
    const byClient = new Map();
    const top = logs.length > 0 ? logs.at(-1).id : null;
    const last = this.saved.lastLogId;
    if (top === null) {
      return { byClient, dirty: false };
    }
    const first = last === null || top < last;
    // After a long outage, only the recent backups are news: no burst of old ones.
    const since = this.now() - this.timings.announceWithinMs;
    for (const log of logs) {
      if (!first && log.id <= last) {
        continue;
      }
      const id = byName.get(log.name);
      if (id === undefined) {
        continue;
      }
      const run = {
        id: log.id,
        result: log.errors > 0 ? 'error' : 'success',
        time: log.time,
        image: log.image,
        errors: log.errors,
        message: '',
        announce: !first && (log.time === null || log.time >= since),
      };
      if (run.result === 'error' && run.announce) {
        run.message = await this.logError(client, log.id);
      }
      byClient.set(id, [...(byClient.get(id) ?? []), run]);
    }
    if (top !== last) {
      this.saved.lastLogId = top;
      return { byClient, dirty: true };
    }
    return { byClient, dirty: false };
  }

  async logError(client, logId) {
    try {
      return await client.logError(logId);
    } catch (err) {
      logger.debug(`Log ${logId} unreadable: ${err.message}`);
      return '';
    }
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`UrBackup: ${err.message}`);
    }
    return wasError !== err.kind;
  }

  /**
   * Compare a client with what was seen before; fire the scene events of the
   * backups that ended and of a client turning overdue. The first sight of a
   * client only records its overdue state.
   * @returns {boolean} whether the saved state changed
   */
  async transition(view, runs, activities) {
    let saved = this.saved.clients[view.id];
    let dirty = false;
    if (!saved) {
      saved = { run: null, overdue: view.overdue };
      this.saved.clients[view.id] = saved;
      dirty = true;
    }
    for (const run of runs) {
      if (run.announce) {
        await this.fireRun(view, run, activities);
      }
    }
    if (runs.length > 0) {
      const { announce: _announce, ...run } = runs.at(-1);
      saved.run = run;
      dirty = true;
    }
    if (view.overdue !== saved.overdue) {
      // null: the threshold changed, nothing to announce.
      if (view.overdue && saved.overdue === false) {
        logger.info(`${view.name} is overdue`);
        await this.fire(TRIGGERS.OVERDUE, view, {
          hours_since_success: hoursSince(view, this.now()),
          last_success: formatTime(view.lastSuccess, this.config.language),
        });
      }
      saved.overdue = view.overdue;
      dirty = true;
    }
    return dirty;
  }

  async fireRun(view, run, activities) {
    const kind = pick(KIND_TEXT[run.image ? 'image' : 'file'], this.config.language);
    if (run.result === 'success') {
      // Its activity: the newest one of the client and kind, started before the log.
      const activity = activities.find(
        (item) =>
          item.clientId === view.id &&
          item.image === run.image &&
          (item.time === null || run.time === null || item.time <= run.time),
      );
      await this.fire(TRIGGERS.SUCCEEDED, view, {
        kind,
        duration_minutes: Math.round((activity?.durationS ?? 0) / 60),
        size: formatBytes(activity?.sizeBytes),
      });
      return;
    }
    logger.info(`${view.name}: backup failed`);
    await this.fire(TRIGGERS.FAILED, view, {
      kind,
      message: run.message,
      errors: run.errors,
    });
  }

  async fire(key, view, extra = {}) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: clientIds(this.gladys, view.id).device,
        client: view.name,
        ...extra,
      });
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    const language = this.config.language;
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    return [
      buildServerDevice(this.gladys, language),
      ...[...this.clients.values()].map((client) =>
        buildClientDevice(this.gladys, client, language),
      ),
    ];
  }

  /** Publish the Discovery list when it changed (a client added, renamed…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read UrBackup, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device.external_id);
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || this.error) {
      return;
    }
    const language = this.config.language;
    const now = this.now();
    const states = [];
    for (const client of this.clients.values()) {
      if (this.isCreated(clientIds(this.gladys, client.id).device)) {
        for (const { key: _key, ...state } of clientValues(this.gladys, client, language, now)) {
          states.push(state);
        }
      }
    }
    if (this.isCreated(serverIds(this.gladys).device)) {
      for (const { key: _key, ...state } of serverValues(this.gladys, [...this.clients.values()])) {
        states.push(state);
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /**
   * The badge of the added devices: local, or unreachable. A client is
   * unreachable when the server does not answer, or when it is offline.
   */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const entries = [];
    const badges = [
      [serverIds(this.gladys).device, !this.error],
      ...[...this.clients.values()].map((client) => [
        clientIds(this.gladys, client.id).device,
        !this.error && client.online,
      ]),
    ];
    for (const [externalId, reachable] of badges) {
      const transport = reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.urlTyped) {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views and commands (widget, scene actions, report) ------------------------------

  /** The client of a device external id, null when it is not one (or no longer exists). */
  find(externalId) {
    const id = parseClientId(this.gladys, externalId);
    return id ? (this.clients.get(id) ?? null) : null;
  }

  /** Throws the reason UrBackup cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** The client of a device, read again if stale; throws a readable error. */
  async clientOf(externalId) {
    // Only the configuration first: a past error is what the read below clears.
    if (!this.client) {
      this.assertReadable();
    }
    await this.refreshIfStale();
    this.assertReadable();
    const client = this.find(externalId);
    if (!client) {
      // One of ours, removed from UrBackup since; or not a client at all.
      const text = parseClientId(this.gladys, externalId)
        ? ERROR_TEXT[ERROR_KINDS.NOT_FOUND]
        : ACTION_TEXT.unknownClient;
      throw new Error(pick(text, this.config.language));
    }
    return client;
  }

  /** Start an incremental file backup now (unless disabled), then read again. */
  async startBackup(view) {
    if (!this.config.allowStart) {
      throw new Error(pick(ACTION_TEXT.startDisabled, this.config.language));
    }
    try {
      await this.client.startBackup(view.id, 'incr_file');
    } catch (err) {
      if (err instanceof UrBackupError) {
        throw new Error(pick(ERROR_TEXT[err.kind], this.config.language), { cause: err });
      }
      throw err;
    }
    logger.info(`${view.name}: file backup started from Gladys`);
    this.startedUntil = this.now() + this.timings.startGraceMs;
    // Read again in the background; every 30 seconds once it runs.
    (this.polling ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.pollNow())
      .catch((err) => logger.debug(`Read after start failed: ${err.message}`))
      .finally(() => this.schedulePoll());
  }

  /** "Test the connection": read UrBackup now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const clients = [...this.clients.values()];
      const parts = [
        text.ok,
        text.clients(clients.length),
        text.online(clients.filter((client) => client.online).length),
      ];
      const failed = clients.filter((client) => client.lastRun?.result === 'error').length;
      const overdue = clients.filter((client) => client.overdue).length;
      if (failed > 0) {
        parts.push(text.failed(failed));
      }
      if (overdue > 0) {
        parts.push(text.overdue(overdue));
      }
      if (this.noLogs) {
        parts.push(pick(ERROR_TEXT[ERROR_KINDS.RIGHTS], language));
      }
      message[language] = labelled('UrBackup', parts.join(', '), language);
    }
    return message;
  }
}

export { ERROR_KINDS };

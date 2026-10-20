// -----------------------------------------------------------------------------
// The view of an UrBackup client (what the server says, put together by
// src/hub.js) and the Gladys devices, proposed in the Discovery tab (the user
// adds the ones to follow, nothing is created on their behalf):
//
//   - one device per client (a computer backed up), identified by its id on
//     the server:
//       state                     text/text      "OK", "Failed", "Overdue"…
//                                                (the language of the configuration)
//       online                    input/binary   1 when connected to the server
//       last_file_backup          text/text      day/month hours:minutes, "-" if none
//       hours_since_file_backup   duration/integer (h)
//       last_image_backup         text/text      day/month hours:minutes, "-" if none
//       hours_since_image_backup  duration/integer (h)
//       running                   input/binary   1 while a backup of it runs
//       progress                  level-sensor/liquid-level-percent (%)
//       errors                    counter-sensor/integer  errors of the last backup
//
//   - one "UrBackup" device for the server: clients online, backups running,
//     clients failed, clients overdue.
//
// Published with should_poll: false: the integration reads UrBackup on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { STATE_TEXT, formatTime, pick } from './texts.js';

export const CLIENT_TYPE = 'client';
export const SERVER_TYPE = 'server';
export const SERVER_ID = 'main';
export const MODEL = 'UrBackup';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  STATE: 'state',
  ONLINE: 'online',
  LAST_FILE: 'last_file_backup',
  HOURS_FILE: 'hours_since_file_backup',
  LAST_IMAGE: 'last_image_backup',
  HOURS_IMAGE: 'hours_since_image_backup',
  RUNNING: 'running',
  PROGRESS: 'progress',
  ERRORS: 'errors',
});

export const SERVER_KEYS = Object.freeze({
  ONLINE: 'clients_online',
  RUNNING: 'backups_running',
  FAILED: 'clients_failed',
  OVERDUE: 'clients_overdue',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.STATE]: 'State',
    [FEATURE_KEYS.ONLINE]: 'Online',
    [FEATURE_KEYS.LAST_FILE]: 'Last file backup',
    [FEATURE_KEYS.HOURS_FILE]: 'Hours since last file backup',
    [FEATURE_KEYS.LAST_IMAGE]: 'Last image backup',
    [FEATURE_KEYS.HOURS_IMAGE]: 'Hours since last image backup',
    [FEATURE_KEYS.RUNNING]: 'Backup running',
    [FEATURE_KEYS.PROGRESS]: 'Progress',
    [FEATURE_KEYS.ERRORS]: 'Errors of the last backup',
    [SERVER_KEYS.ONLINE]: 'Clients online',
    [SERVER_KEYS.RUNNING]: 'Backups running',
    [SERVER_KEYS.FAILED]: 'Failed clients',
    [SERVER_KEYS.OVERDUE]: 'Overdue clients',
  },
  fr: {
    [FEATURE_KEYS.STATE]: 'État',
    [FEATURE_KEYS.ONLINE]: 'En ligne',
    [FEATURE_KEYS.LAST_FILE]: 'Dernière sauvegarde de fichiers',
    [FEATURE_KEYS.HOURS_FILE]: 'Heures depuis la sauvegarde de fichiers',
    [FEATURE_KEYS.LAST_IMAGE]: "Dernière sauvegarde d'image",
    [FEATURE_KEYS.HOURS_IMAGE]: "Heures depuis la sauvegarde d'image",
    [FEATURE_KEYS.RUNNING]: 'Sauvegarde en cours',
    [FEATURE_KEYS.PROGRESS]: 'Progression',
    [FEATURE_KEYS.ERRORS]: 'Erreurs de la dernière sauvegarde',
    [SERVER_KEYS.ONLINE]: 'Clients en ligne',
    [SERVER_KEYS.RUNNING]: 'Sauvegardes en cours',
    [SERVER_KEYS.FAILED]: 'Clients en échec',
    [SERVER_KEYS.OVERDUE]: 'Clients en retard',
  },
  de: {
    [FEATURE_KEYS.STATE]: 'Zustand',
    [FEATURE_KEYS.ONLINE]: 'Online',
    [FEATURE_KEYS.LAST_FILE]: 'Letzte Dateisicherung',
    [FEATURE_KEYS.HOURS_FILE]: 'Stunden seit letzter Dateisicherung',
    [FEATURE_KEYS.LAST_IMAGE]: 'Letzte Image-Sicherung',
    [FEATURE_KEYS.HOURS_IMAGE]: 'Stunden seit letzter Image-Sicherung',
    [FEATURE_KEYS.RUNNING]: 'Sicherung läuft',
    [FEATURE_KEYS.PROGRESS]: 'Fortschritt',
    [FEATURE_KEYS.ERRORS]: 'Fehler der letzten Sicherung',
    [SERVER_KEYS.ONLINE]: 'Clients online',
    [SERVER_KEYS.RUNNING]: 'Laufende Sicherungen',
    [SERVER_KEYS.FAILED]: 'Fehlgeschlagene Clients',
    [SERVER_KEYS.OVERDUE]: 'Überfällige Clients',
  },
  es: {
    [FEATURE_KEYS.STATE]: 'Estado',
    [FEATURE_KEYS.ONLINE]: 'En línea',
    [FEATURE_KEYS.LAST_FILE]: 'Última copia de archivos',
    [FEATURE_KEYS.HOURS_FILE]: 'Horas desde la copia de archivos',
    [FEATURE_KEYS.LAST_IMAGE]: 'Última copia de imagen',
    [FEATURE_KEYS.HOURS_IMAGE]: 'Horas desde la copia de imagen',
    [FEATURE_KEYS.RUNNING]: 'Copia en curso',
    [FEATURE_KEYS.PROGRESS]: 'Progreso',
    [FEATURE_KEYS.ERRORS]: 'Errores de la última copia',
    [SERVER_KEYS.ONLINE]: 'Clientes en línea',
    [SERVER_KEYS.RUNNING]: 'Copias en curso',
    [SERVER_KEYS.FAILED]: 'Clientes fallidos',
    [SERVER_KEYS.OVERDUE]: 'Clientes con retraso',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_HOURS = 100_000;
export const MAX_COUNT = 1_000_000_000;
export const MAX_CLIENTS = 10_000;

const HOUR_MS = 3_600_000;

/**
 * Whether a client is overdue. Automatic: UrBackup's own verdict on the file
 * backups (file_ok: a backup within the interval of its settings), for a
 * client backed up at least once. Fixed: no successful backup, file or image,
 * for that many hours.
 */
export function isOverdue(client, overdueHours, now) {
  if (client.lastSuccess === null) {
    return false;
  }
  if (overdueHours) {
    return now - client.lastSuccess > overdueHours * HOUR_MS;
  }
  return client.fileEnabled && client.lastFile !== null && !client.fileOk;
}

/**
 * The state of a client, by what needs attention first.
 * @returns {'running'|'failed'|'overdue'|'ok'|'never'}
 */
export function stateOf(client) {
  if (client.running) {
    return 'running';
  }
  if (client.lastRun?.result === 'error') {
    return 'failed';
  }
  if (client.overdue) {
    return 'overdue';
  }
  return client.lastSuccess !== null || client.lastRun ? 'ok' : 'never';
}

const hoursFrom = (time, now) =>
  time === null ? null : Math.max(0, Math.floor((now - time) / HOUR_MS));

/** Whole hours since the last success (file or image), null if none. */
export const hoursSince = (client, now) => hoursFrom(client.lastSuccess, now);

export const clientIds = (gladys, id) => gladys.externalIds(CLIENT_TYPE, id);
export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);

/** The client id of a device external id, null when it is not a client of ours. */
export function parseClientId(gladys, externalId) {
  const prefix = clientIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^\d{1,12}$/.test(id) ? id : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    min: 0,
    max: 0,
  });

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

const hours = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.DURATION,
    DEVICE_FEATURE_TYPES.DURATION.INTEGER,
    { unit: DEVICE_FEATURE_UNITS.HOURS, keep_history: true, min: 0, max: MAX_HOURS },
  );

const percent = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
    DEVICE_FEATURE_TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    { unit: DEVICE_FEATURE_UNITS.PERCENT, keep_history: false, min: 0, max: 100 },
  );

/** The discovery payload of a client. */
export function buildClientDevice(gladys, client, language = 'en') {
  const ids = clientIds(gladys, client.id);
  const names = NAMES[language] ?? NAMES.en;
  const feature = (key) => ids.feature(key);
  return {
    name: client.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [{ name: 'CLIENT_ID', value: client.id }],
    features: [
      text(names[FEATURE_KEYS.STATE], feature(FEATURE_KEYS.STATE)),
      binary(names[FEATURE_KEYS.ONLINE], feature(FEATURE_KEYS.ONLINE)),
      text(names[FEATURE_KEYS.LAST_FILE], feature(FEATURE_KEYS.LAST_FILE)),
      hours(names[FEATURE_KEYS.HOURS_FILE], feature(FEATURE_KEYS.HOURS_FILE)),
      text(names[FEATURE_KEYS.LAST_IMAGE], feature(FEATURE_KEYS.LAST_IMAGE)),
      hours(names[FEATURE_KEYS.HOURS_IMAGE], feature(FEATURE_KEYS.HOURS_IMAGE)),
      binary(names[FEATURE_KEYS.RUNNING], feature(FEATURE_KEYS.RUNNING)),
      percent(names[FEATURE_KEYS.PROGRESS], feature(FEATURE_KEYS.PROGRESS)),
      counter(names[FEATURE_KEYS.ERRORS], feature(FEATURE_KEYS.ERRORS), MAX_COUNT),
    ],
  };
}

/** The discovery payload of the server. */
export function buildServerDevice(gladys, language = 'en') {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: 'UrBackup',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: Object.values(SERVER_KEYS).map((key) =>
      counter(names[key], ids.feature(key), MAX_CLIENTS),
    ),
  };
}

const dateText = (time, language) => (time === null ? '-' : formatTime(time, language));

/**
 * The value of every feature of a client: `{ key, device_feature_external_id,
 * state|text }`, nothing for a value that is not known.
 */
export function clientValues(gladys, client, language, now) {
  const ids = clientIds(gladys, client.id);
  const values = [
    { key: FEATURE_KEYS.STATE, text: pick(STATE_TEXT[stateOf(client)], language) },
    { key: FEATURE_KEYS.ONLINE, state: client.online ? 1 : 0 },
    { key: FEATURE_KEYS.LAST_FILE, text: dateText(client.lastFile, language) },
    { key: FEATURE_KEYS.LAST_IMAGE, text: dateText(client.lastImage, language) },
  ];
  const fileHours = hoursFrom(client.lastFile, now);
  if (fileHours !== null) {
    values.push({ key: FEATURE_KEYS.HOURS_FILE, state: Math.min(fileHours, MAX_HOURS) });
  }
  const imageHours = hoursFrom(client.lastImage, now);
  if (imageHours !== null) {
    values.push({ key: FEATURE_KEYS.HOURS_IMAGE, state: Math.min(imageHours, MAX_HOURS) });
  }
  values.push(
    { key: FEATURE_KEYS.RUNNING, state: client.running ? 1 : 0 },
    { key: FEATURE_KEYS.PROGRESS, state: client.running ? (client.progress ?? 0) : 0 },
    { key: FEATURE_KEYS.ERRORS, state: Math.min(client.lastRun?.errors ?? 0, MAX_COUNT) },
  );
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

/** The values of the server device. */
export function serverValues(gladys, clients) {
  const ids = serverIds(gladys);
  const values = [
    { key: SERVER_KEYS.ONLINE, state: clients.filter((client) => client.online).length },
    { key: SERVER_KEYS.RUNNING, state: clients.filter((client) => client.running).length },
    // The last backup, not the state: a failed client running again still counts.
    {
      key: SERVER_KEYS.FAILED,
      state: clients.filter((client) => client.lastRun?.result === 'error').length,
    },
    { key: SERVER_KEYS.OVERDUE, state: clients.filter((client) => client.overdue).length },
  ];
  return values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

// -----------------------------------------------------------------------------
// UrBackup client: the JSON API of the server web interface (port 55414), the
// one its pages use, checked against a real UrBackup server 2.5.37 and client
// 2.5.31 (Docker images uroni/urbackup-server and uroni/urbackup-client).
//
//   POST /x?a=login                anonymous login (a server without any user),
//                                  or the login with the hashed password
//   POST /x?a=salt                 username → session, salt, rnd, pbkdf2_rounds
//   POST /x?a=status               the clients: online, last file and image
//                                  backups, file_ok / image_ok, processes
//   POST /x?a=progress             the backups running and the last activities
//                                  (lastacts: duration, size of the backups)
//   POST /x?a=logs                 one entry per backup ended, with its errors
//   POST /x?a=logs&logid=N         the lines of one log
//   POST /x?a=start_backup         start_client, start_type (incr_file…)
//
// Every call but the login carries the session (`ses`). {"error":1} means a
// session refused (the server restarted) or a right missing (the logs of a
// limited user): the session is opened again once, and a second refusal is
// a right missing.
// The login follows urbackup-server-web-api-wrapper (Apache 2.0, uroni):
// md5(salt + password), then PBKDF2-SHA256 when the server asks for rounds,
// then md5(rnd + that hex).
// -----------------------------------------------------------------------------

import { createHash, pbkdf2Sync } from 'node:crypto';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  AUTH: 'auth', // username or password refused
  RIGHTS: 'rights', // the user may not read the status of the clients
  NOT_URBACKUP: 'not_urbackup', // something answers, not an UrBackup server
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  UPGRADING: 'upgrading', // the server is upgrading its database
  NOT_FOUND: 'not_found', // the client no longer exists
  START_REFUSED: 'start_refused', // the server did not start the backup
  HTTP: 'http', // any other HTTP error
});

export class UrBackupError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   */
  constructor(kind, message) {
    super(message);
    this.name = 'UrBackupError';
    this.kind = kind;
  }
}

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

// A user without the logs right: asked again this often.
const LOGS_RETRY_MS = 3_600_000;

/**
 * The one function that talks to the network. The client takes it as a
 * parameter: the tests replace it with an in-memory server
 * (test/helpers/fakeUrBackup.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(address, { body, timeoutMs = 30_000 } = {}) {
  const response = await fetch(address, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new Error('Response too large');
  }
  return { status: response.status, body: text };
}

const md5 = (value) => createHash('md5').update(value).digest();

/** The password proof the server expects, from its salt answer. */
export function passwordProof(password, { salt, rnd, pbkdf2_rounds: rounds }) {
  const hash = md5(`${salt}${password}`);
  let hex = hash.toString('hex');
  if (Number(rounds) > 0) {
    hex = pbkdf2Sync(hash, String(salt), Number(rounds), 32, 'sha256').toString('hex');
  }
  return md5(`${rnd}${hex}`).toString('hex');
}

/** Seconds since 1970 (0 or "-" for never) → ms, or null. */
const time = (value) => (Number.isFinite(value) && value > 0 ? value * 1000 : null);
const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

// `processes[].action` and `progress[].action` of UrBackup.
const IMAGE_ACTIONS = new Set([3, 4]);

/** A client of `status`, as the rest of the code uses it. */
export function normalizeClient(item) {
  const processes = Array.isArray(item.processes) ? item.processes : [];
  const pcdone = processes.map((process) => process.pcdone).find(Number.isFinite);
  return {
    id: String(item.id),
    name: typeof item.name === 'string' && item.name ? item.name : `#${item.id}`,
    online: item.online === true,
    lastFile: time(item.lastbackup),
    lastImage: time(item.lastbackup_image),
    fileOk: item.file_ok === true,
    imageOk: item.image_ok === true,
    // Disabled for the client, or not possible (images: Windows only).
    fileEnabled: item.file_disabled !== true,
    imageEnabled: item.image_disabled !== true && item.image_not_supported !== true,
    issues: count(item.last_filebackup_issues),
    running: processes.length > 0,
    runningImage: processes.some((process) => IMAGE_ACTIONS.has(process.action)),
    // -1 while UrBackup cannot tell yet.
    progress: pcdone !== undefined && pcdone >= 0 ? Math.min(100, Math.round(pcdone)) : null,
  };
}

export function normalizeStatus(data) {
  if (!Array.isArray(data?.status)) {
    throw new UrBackupError(ERROR_KINDS.RIGHTS, 'No client status in the answer (rights?)');
  }
  return {
    version: typeof data.curr_version_str === 'string' ? data.curr_version_str : null,
    clients: data.status
      .filter((item) => Number.isInteger(item?.id) && !item.delete_pending)
      .map(normalizeClient),
  };
}

/** The last activities (`progress` → lastacts): duration and size of the backups. */
export function normalizeActivities(data) {
  return (Array.isArray(data?.lastacts) ? data.lastacts : [])
    .filter((item) => !item.restore && !item.del && Number.isInteger(item.clientid))
    .map((item) => ({
      id: item.id,
      clientId: String(item.clientid),
      time: time(item.backuptime),
      image: Boolean(item.image),
      incremental: Boolean(item.incremental),
      durationS: count(item.duration),
      sizeBytes: Number.isFinite(item.size_bytes) && item.size_bytes >= 0 ? item.size_bytes : null,
    }));
}

/**
 * The backup logs (`logs`), oldest first, restores apart. null when the user
 * may not read them (the answer has no `logs`).
 */
export function normalizeLogs(data) {
  if (!Array.isArray(data?.logs)) {
    return null;
  }
  return data.logs
    .filter((item) => Number.isInteger(item?.id) && !item.restore)
    .map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' ? item.name : '',
      time: time(item.time),
      image: Boolean(item.image),
      incremental: Boolean(item.incremental),
      errors: count(item.errors),
      warnings: count(item.warnings),
    }))
    .sort((a, b) => a.id - b.id);
}

const clean = (text) =>
  text
    // An address with credentials, if UrBackup ever quotes one.
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

/**
 * The first error of a log: its lines read "level-time-message", level 2 an
 * error. "Backup failed" is the conclusion, not the cause: kept last.
 */
export function firstError(data) {
  const lines = typeof data?.log?.data === 'string' ? data.log.data.split('\n') : [];
  const errors = lines
    .map((line) => /^(\d+)-\d+-(.*)$/.exec(line))
    .filter((match) => match && Number(match[1]) >= 2)
    .map((match) => clean(match[2]))
    .filter(Boolean);
  return errors.find((line) => !/^backup failed$/i.test(line)) ?? errors[0] ?? '';
}

export class UrBackupClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, without /x
   * @param {string} options.username
   * @param {string} options.password
   * @param {Function} [options.request] the HTTP seam (httpRequest)
   */
  constructor({ url, username, password, request = httpRequest }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.request = request;
    this.session = null;
    this.logging = null;
    this.logsDeniedAt = null;
  }

  /** One API call, without session handling. */
  async send(action, params = {}) {
    let response;
    try {
      response = await this.request(`${this.url}/x?a=${encodeURIComponent(action)}`, {
        body: new URLSearchParams(params).toString(),
      });
    } catch (err) {
      throw new UrBackupError(
        ERROR_KINDS.UNREACHABLE,
        `No answer (${err.cause?.code ?? err.code ?? err.name ?? 'error'})`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      throw new UrBackupError(ERROR_KINDS.REDIRECT, `HTTP ${response.status} (redirect)`);
    }
    if (response.status === 404) {
      throw new UrBackupError(ERROR_KINDS.NOT_URBACKUP, 'HTTP 404: no UrBackup API here');
    }
    if (response.status !== 200) {
      throw new UrBackupError(ERROR_KINDS.HTTP, `HTTP ${response.status}`);
    }
    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      throw new UrBackupError(ERROR_KINDS.NOT_URBACKUP, 'Not a JSON answer: no UrBackup API here');
    }
    if (!data || typeof data !== 'object') {
      throw new UrBackupError(ERROR_KINDS.NOT_URBACKUP, 'Unexpected answer');
    }
    return data;
  }

  /** Open a session; concurrent calls share it. */
  login() {
    if (!this.logging) {
      this.logging = this.openSession().finally(() => {
        this.logging = null;
      });
    }
    return this.logging;
  }

  async openSession() {
    this.session = null;
    const anonymous = await this.send('login');
    if (anonymous.upgrading_database) {
      throw new UrBackupError(ERROR_KINDS.UPGRADING, 'The server is upgrading its database');
    }
    if (anonymous.success === true && typeof anonymous.session === 'string') {
      // No user defined on the server: everyone is admin.
      this.session = anonymous.session;
      return;
    }
    if (anonymous.api_version === undefined && anonymous.success === undefined) {
      throw new UrBackupError(ERROR_KINDS.NOT_URBACKUP, 'Unexpected login answer');
    }
    if (!this.username) {
      throw new UrBackupError(ERROR_KINDS.AUTH, 'The server wants a username');
    }
    const salt = await this.send('salt', { username: this.username });
    if (typeof salt.ses !== 'string' || typeof salt.salt !== 'string') {
      throw new UrBackupError(ERROR_KINDS.AUTH, 'Unknown username');
    }
    const login = await this.send('login', {
      username: this.username,
      password: passwordProof(this.password, salt),
      ses: salt.ses,
    });
    if (login.success !== true) {
      throw new UrBackupError(ERROR_KINDS.AUTH, 'Password refused');
    }
    this.session = salt.ses;
  }

  /** An API call with the session, opened again once when refused. */
  async call(action, params = {}) {
    for (let attempt = 0; ; attempt += 1) {
      if (!this.session) {
        await this.login();
      }
      const data = await this.send(action, { ...params, ses: this.session });
      // {"error":1}: unknown session (expired, or the server restarted)…
      if (data.error === 1 && attempt === 0) {
        this.session = null;
        continue;
      }
      // …or, with a session just opened, a right the user does not have.
      if (data.error === 1) {
        throw new UrBackupError(ERROR_KINDS.RIGHTS, `No right for ${action}`);
      }
      return data;
    }
  }

  async status() {
    return normalizeStatus(await this.call('status'));
  }

  async activities() {
    return normalizeActivities(await this.call('progress'));
  }

  /** The backup logs; null when the user may not read them (tried again hourly). */
  async logs() {
    if (this.logsDeniedAt !== null && Date.now() - this.logsDeniedAt < LOGS_RETRY_MS) {
      return null;
    }
    try {
      const logs = normalizeLogs(await this.call('logs', { ll: '0' }));
      this.logsDeniedAt = logs === null ? Date.now() : null;
      return logs;
    } catch (err) {
      if (err instanceof UrBackupError && err.kind === ERROR_KINDS.RIGHTS) {
        this.logsDeniedAt = Date.now();
        return null;
      }
      throw err;
    }
  }

  /** The first error of a log, '' when unreadable. */
  async logError(logId) {
    return firstError(await this.call('logs', { logid: String(logId) }));
  }

  /** Start a backup of a client: incr_file, full_file, incr_image, full_image. */
  async startBackup(clientId, type = 'incr_file') {
    const data = await this.call('start_backup', {
      start_client: String(clientId),
      start_type: type,
    });
    const result = Array.isArray(data.result) ? data.result[0] : null;
    if (!result) {
      throw new UrBackupError(ERROR_KINDS.RIGHTS, 'Backup not started (rights?)');
    }
    if (result.start_ok !== true) {
      throw new UrBackupError(ERROR_KINDS.START_REFUSED, 'Backup not started by the server');
    }
  }
}

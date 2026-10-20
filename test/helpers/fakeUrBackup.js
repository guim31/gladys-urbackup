// -----------------------------------------------------------------------------
// An in-memory UrBackup server, behind the request seam of the client
// (src/urbackup/client.js): the login with salt and PBKDF2, sessions, status,
// progress (last activities), logs and start_backup, answering with the shapes
// recorded on a real UrBackup 2.5.37 (test/fixtures/urbackup).
// -----------------------------------------------------------------------------

import { passwordProof } from '../../src/urbackup/client.js';

export const BASE = 'http://192.0.2.10:55414';
export const USERNAME = 'admin';
export const PASSWORD = 'test-pass';

const SALT = 'abcdefghij0123456789';
const ROUNDS = 10000;
const seconds = (ms) => (ms === null ? 0 : Math.floor(ms / 1000));
const ok = (data) => ({ status: 200, body: JSON.stringify(data) });

export class FakeUrBackup {
  constructor({ username = USERNAME, password = PASSWORD, anonymous = false } = {}) {
    this.username = username;
    this.password = password;
    this.anonymous = anonymous;
    /** @type {Map<number, object>} */
    this.clients = new Map();
    this.logs = [];
    this.activities = [];
    this.sessions = new Set();
    this.pending = new Map(); // salt sessions: rnd
    this.down = false;
    this.calls = [];
    this.logRight = true;
    this.startOk = true;
    this.nextId = 1;
    this.request = this.request.bind(this);
  }

  /** A client: online, last backups (ms), file_ok / image_ok. */
  add(name, options = {}) {
    const id = this.nextId++;
    this.clients.set(id, {
      id,
      name,
      online: options.online ?? true,
      lastFile: options.lastFile ?? null,
      lastImage: options.lastImage ?? null,
      fileOk: options.fileOk ?? options.lastFile !== undefined,
      imageOk: options.imageOk ?? false,
      imageNotSupported: options.imageNotSupported ?? true,
      processes: [],
    });
    return id;
  }

  get(name) {
    return [...this.clients.values()].find((client) => client.name === name);
  }

  /** A backup that ended at `end`: a log, and on success an activity and the last backup. */
  backup(name, result, { end, image = false, errors = 2, seconds: duration = 60, size = 0 }) {
    const client = this.get(name);
    const id = this.logs.length + 1;
    this.logs.push({
      id,
      name,
      time: Math.floor(end / 1000),
      image: image ? 1 : 0,
      incremental: 1,
      restore: 0,
      resumed: 0,
      errors: result === 'error' ? errors : 0,
      warnings: 0,
      data:
        result === 'error'
          ? `2-${Math.floor(end / 1000)}-Cannot read the folder /home/anna (code: 2)\n2-${Math.floor(end / 1000)}-Backup failed\n`
          : `0-${Math.floor(end / 1000)}-Backup completed\n`,
    });
    if (result === 'success') {
      const start = end - duration * 1000;
      this.activities.unshift({
        id: this.activities.length + 1,
        clientid: client.id,
        name,
        backuptime: Math.floor(start / 1000),
        duration,
        size_bytes: size,
        image: image ? 1 : 0,
        incremental: 1,
        restore: 0,
        resumed: 0,
        del: false,
        details: '',
      });
      if (image) {
        client.lastImage = start;
        client.imageOk = true;
      } else {
        client.lastFile = start;
        client.fileOk = true;
      }
    }
    client.processes = [];
  }

  /** The server restarts: every session is lost. */
  restart() {
    this.sessions.clear();
    this.pending.clear();
  }

  statusOf(client) {
    return {
      id: client.id,
      name: client.name,
      online: client.online,
      lastbackup: seconds(client.lastFile),
      lastbackup_image: seconds(client.lastImage),
      file_ok: client.fileOk,
      image_ok: client.imageOk,
      ...(client.imageNotSupported ? { image_not_supported: true } : {}),
      last_filebackup_issues: 0,
      delete_pending: '',
      processes: client.processes,
      status: client.processes.length > 0 ? 2 : 0,
      ip: client.online ? '192.0.2.21' : '-',
      uid: 'Zx8Yw7Vu6Ts5Rq4P',
    };
  }

  async request(address, { body = '' } = {}) {
    const url = new URL(address);
    const action = url.searchParams.get('a');
    const params = Object.fromEntries(new URLSearchParams(body));
    this.calls.push(action);
    if (this.down) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    if (url.pathname !== '/x') {
      return { status: 404, body: 'Not found' };
    }
    switch (action) {
      case 'login':
        return this.login(params);
      case 'salt': {
        const ses = `salt${this.pending.size + 1}`;
        if (params.username !== this.username) {
          return ok({ error: 0, ses });
        }
        const rnd = `rnd${this.pending.size + 1}`;
        this.pending.set(ses, rnd);
        return ok({ error: 0, ses, salt: SALT, rnd, pbkdf2_rounds: ROUNDS });
      }
      default:
        break;
    }
    if (!this.sessions.has(params.ses)) {
      return ok({ error: 1 });
    }
    switch (action) {
      case 'status':
        return ok({
          curr_version_str: '2.5.37',
          status: [...this.clients.values()].map((client) => this.statusOf(client)),
          extra_clients: [],
        });
      case 'progress':
        return ok({
          progress: [...this.clients.values()].flatMap((client) =>
            client.processes.map((process) => ({
              clientid: client.id,
              name: client.name,
              ...process,
            })),
          ),
          lastacts: this.activities,
        });
      case 'logs': {
        if (!this.logRight) {
          // Recorded on the real server for a user without the logs right.
          return ok({ error: 1 });
        }
        if (params.logid) {
          const log = this.logs.find((item) => item.id === Number(params.logid));
          return ok(log ? { log: { clientname: log.name, data: log.data, time: log.time } } : {});
        }
        return ok({
          logs: [...this.logs].reverse().map(({ data: _data, ...log }) => log),
        });
      }
      case 'start_backup': {
        const client = this.clients.get(Number(params.start_client));
        const started = Boolean(client?.online) && this.startOk;
        if (started) {
          client.processes = [{ action: 1, pcdone: -1 }];
          this.started = { id: client.id, type: params.start_type };
        }
        return ok({
          result: [
            {
              clientid: Number(params.start_client),
              start_type: params.start_type,
              start_ok: started,
            },
          ],
        });
      }
      default:
        return { status: 200, body: `Error: Unknown action [${action}]` };
    }
  }

  login({ username, password, ses }) {
    if (this.anonymous) {
      const session = `anon${this.sessions.size + 1}`;
      this.sessions.add(session);
      return ok({ api_version: 2, lang: 'en', session, success: true });
    }
    if (!username) {
      return ok({ admin_only: 'admin', api_version: 2, lang: 'en', success: false });
    }
    const rnd = this.pending.get(ses);
    const expected =
      rnd && passwordProof(this.password, { salt: SALT, rnd, pbkdf2_rounds: ROUNDS });
    if (username !== this.username || password !== expected) {
      return ok({ api_version: 2, error: 2 });
    }
    this.pending.delete(ses);
    this.sessions.add(ses);
    return ok({ api_version: 2, lang: 'en', success: true });
  }
}

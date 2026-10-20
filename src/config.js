// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One UrBackup server, reached through its web interface (port 55414) with a
// user of that interface. A server without any user needs no password.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['60', '300', '900'];

// "Overdue after": automatic (UrBackup's own verdict) or fixed hours.
export const OVERDUE_CHOICES = ['auto', '12', '24', '48', '72', '168'];

export const DEFAULT_PORT = 55414;
export const DEFAULT_USERNAME = 'admin';

export const DEFAULT_CONFIG = {
  url: '',
  username: DEFAULT_USERNAME,
  password: '',
  poll_interval: '300',
  overdue_hours: 'auto',
  allow_start: true,
  language: 'fr',
};

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 55414 then), or a URL copied from the browser
 * (`http://192.0.2.10:55414/#status`, `…/x`). HTTP by default for a bare
 * host. A path is kept (a server behind a reverse proxy sub-path).
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(bare ? `http://${text}` : text);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  if (bare && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(/\/(x|index\.html?)$/i, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const typed = text('url');
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  const overdue = OVERDUE_CHOICES.includes(String(source.overdue_hours))
    ? String(source.overdue_hours)
    : DEFAULT_CONFIG.overdue_hours;
  return {
    url: typed ? parseServerUrl(typed) : null,
    urlTyped: Boolean(typed),
    // A blank username stays blank: only a server without users accepts it.
    username: source.username === undefined ? DEFAULT_USERNAME : text('username'),
    // Never trimmed: a password may end with a space.
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(pollInterval) * 1000,
    overdueHours: overdue === 'auto' ? null : Number(overdue),
    allowStart: source.allow_start !== false && source.allow_start !== 'false',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

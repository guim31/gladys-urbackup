// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `urbackup`.
//
// The use case: a glance at the wall tablet tells whether the computers were
// backed up, and which one was not. So the widget shows the number of clients
// failed, overdue and online, then one row per client — failed first, then
// overdue, running, without backup, OK — with its state and its last backup
// (or the progress of the one running), and a grey icon when it is offline.
//
// Every client by default, or the ones chosen in the widget settings (devices
// added to Gladys). The figures are sent as values, not bound to device
// features: the widget works before the devices are added.
//
// Budget (8 components, 2 texts): three tiles, one text when UrBackup does not
// answer, one status list of ten rows at most, a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { stateOf } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, STATE_TEXT, formatTime, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Enter the address of your UrBackup server in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur UrBackup dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines UrBackup-Servers in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor UrBackup en la configuración de la integración.',
  },
  empty: {
    en: 'No client yet: install the UrBackup client on a computer.',
    fr: 'Aucun client pour le moment : installez le client UrBackup sur un ordinateur.',
    de: 'Noch kein Client: Installiere den UrBackup-Client auf einem Computer.',
    es: 'Todavía no hay ningún cliente: instale el cliente de UrBackup en un ordenador.',
  },
  failed: { en: 'Failed', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallidos' },
  overdue: { en: 'Overdue', fr: 'En retard', de: 'Überfällig', es: 'Con retraso' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'UrBackup read again.',
    fr: 'UrBackup relu.',
    de: 'UrBackup neu gelesen.',
    es: 'UrBackup leído de nuevo.',
  },
};

// Row order: what needs attention first.
const SEVERITY = ['failed', 'overdue', 'running', 'never', 'ok'];

const ROW_STYLE = {
  failed: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  overdue: { icon: 'clock', color: WIDGET_COLORS.WARNING },
  running: { icon: 'play-circle', color: WIDGET_COLORS.INFO },
  never: { icon: 'circle', color: WIDGET_COLORS.NEUTRAL },
  ok: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The clients the widget shows: the chosen devices, or every client. */
export function selectClients(hub, settings) {
  const chosen = [settings?.clients ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length === 0) {
    return [...hub.clients.values()];
  }
  return [...new Set(chosen)].map((id) => hub.find(id)).filter(Boolean);
}

export function sortClients(clients) {
  return [...clients].sort(
    (a, b) =>
      SEVERITY.indexOf(stateOf(a)) - SEVERITY.indexOf(stateOf(b)) || a.name.localeCompare(b.name),
  );
}

function rowValue(client, language) {
  const state = stateOf(client);
  const text = pick(STATE_TEXT[state], language);
  if (state === 'running') {
    return client.progress === null ? text : `${text} · ${client.progress} %`;
  }
  return client.lastSuccess === null
    ? text
    : `${text} · ${formatTime(client.lastSuccess, language)}`;
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.pick, language);
  }
  const clients = sortClients(selectClients(hub, settings));
  if (clients.length === 0 && !hub.error) {
    return message(TEXT.empty, language);
  }

  const failed = clients.filter((client) => client.lastRun?.result === 'error').length;
  const overdue = clients.filter((client) => client.overdue).length;
  const online = clients.filter((client) => client.online).length;
  const components = [
    {
      type: 'value',
      value: failed,
      label: pick(TEXT.failed, language),
      icon: 'x-circle',
      color: failed > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: overdue,
      label: pick(TEXT.overdue, language),
      icon: 'clock',
      color: overdue > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: online,
      label: pick(TEXT.online, language),
      icon: 'monitor',
      color: online > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
  ];

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  if (clients.length > 0) {
    const shown = clients.length > MAX_ROWS ? clients.slice(0, MAX_ROWS - 1) : clients;
    const items = shown.map((client) => {
      const style = ROW_STYLE[stateOf(client)];
      return {
        label: fit(client.name, 40),
        value: fit(rowValue(client, language), 40),
        icon: style.icon,
        // Offline and fine: grey, the state still in words.
        color: client.online || style !== ROW_STYLE.ok ? style.color : WIDGET_COLORS.NEUTRAL,
      };
    });
    if (clients.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${clients.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  // A backup running moves: refresh sooner.
  return { ttl_seconds: hub.error || hub.running ? 30 : 120, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};

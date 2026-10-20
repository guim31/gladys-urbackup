// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, client states, the "Test the connection" report,
// scene outputs and errors, dates. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './urbackup/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your UrBackup server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur UrBackup dans la configuration.",
    de: 'Gib die Adresse deines UrBackup-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor UrBackup en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:55414',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:55414',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:55414',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:55414',
  },
};

// One short explanation per error kind (src/urbackup/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'UrBackup does not answer',
    fr: 'UrBackup ne répond pas',
    de: 'UrBackup antwortet nicht',
    es: 'UrBackup no responde',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'username or password refused by UrBackup',
    fr: "nom d'utilisateur ou mot de passe refusé par UrBackup",
    de: 'Benutzername oder Passwort von UrBackup abgelehnt',
    es: 'usuario o contraseña rechazados por UrBackup',
  },
  [ERROR_KINDS.RIGHTS]: {
    en: 'this UrBackup user lacks a right (status, progress, logs, start_backup)',
    fr: 'il manque un droit à cet utilisateur UrBackup (status, progress, logs, start_backup)',
    de: 'diesem UrBackup-Benutzer fehlt ein Recht (status, progress, logs, start_backup)',
    es: 'a este usuario de UrBackup le falta un permiso (status, progress, logs, start_backup)',
  },
  [ERROR_KINDS.NOT_URBACKUP]: {
    en: 'no UrBackup server at this address',
    fr: 'aucun serveur UrBackup à cette adresse',
    de: 'kein UrBackup-Server unter dieser Adresse',
    es: 'no hay ningún servidor UrBackup en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.UPGRADING]: {
    en: 'UrBackup is upgrading its database, please wait',
    fr: 'UrBackup met à jour sa base de données, patientez',
    de: 'UrBackup aktualisiert seine Datenbank, bitte warte',
    es: 'UrBackup está actualizando su base de datos, espere',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'this client no longer exists in UrBackup',
    fr: "ce client n'existe plus dans UrBackup",
    de: 'dieser Client existiert in UrBackup nicht mehr',
    es: 'este cliente ya no existe en UrBackup',
  },
  [ERROR_KINDS.START_REFUSED]: {
    en: 'UrBackup did not start the backup (client offline, or a backup already running?)',
    fr: "UrBackup n'a pas lancé la sauvegarde (client hors ligne, ou sauvegarde déjà en cours ?)",
    de: 'UrBackup hat die Sicherung nicht gestartet (Client offline oder läuft schon eine?)',
    es: 'UrBackup no inició la copia (¿cliente desconectado o ya hay una copia en curso?)',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a client, in words (feature "State", widget rows, scene outputs).
export const STATE_TEXT = {
  ok: { en: 'OK', fr: 'OK', de: 'OK', es: 'Correcto' },
  failed: { en: 'Failed', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallido' },
  overdue: { en: 'Overdue', fr: 'En retard', de: 'Überfällig', es: 'Con retraso' },
  running: { en: 'Running', fr: 'En cours', de: 'Läuft', es: 'En curso' },
  never: { en: 'No backup', fr: 'Aucune sauvegarde', de: 'Keine Sicherung', es: 'Sin copia' },
};

// The kind of a backup (variable of "A backup succeeds").
export const KIND_TEXT = {
  file: { en: 'files', fr: 'fichiers', de: 'Dateien', es: 'archivos' },
  image: { en: 'image', fr: 'image', de: 'Image', es: 'imagen' },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    clients: (count) => `${count} client(s)`,
    online: (count) => `${count} online`,
    failed: (count) => `${count} failed`,
    overdue: (count) => `${count} overdue`,
  },
  fr: {
    ok: 'Connecté',
    clients: (count) => `${count} client(s)`,
    online: (count) => `${count} en ligne`,
    failed: (count) => `${count} en échec`,
    overdue: (count) => `${count} en retard`,
  },
  de: {
    ok: 'Verbunden',
    clients: (count) => `${count} Client(s)`,
    online: (count) => `${count} online`,
    failed: (count) => `${count} fehlgeschlagen`,
    overdue: (count) => `${count} überfällig`,
  },
  es: {
    ok: 'Conectado',
    clients: (count) => `${count} cliente(s)`,
    online: (count) => `${count} en línea`,
    failed: (count) => `${count} fallido(s)`,
    overdue: (count) => `${count} con retraso`,
  },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  unknownClient: {
    en: 'This device is not an UrBackup client.',
    fr: "Cet appareil n'est pas un client UrBackup.",
    de: 'Dieses Gerät ist kein UrBackup-Client.',
    es: 'Este dispositivo no es un cliente de UrBackup.',
  },
  startDisabled: {
    en: 'Starting backups from Gladys is disabled in the configuration of the integration.',
    fr: "Le lancement des sauvegardes depuis Gladys est désactivé dans la configuration de l'intégration.",
    de: 'Das Starten von Sicherungen aus Gladys ist in der Konfiguration der Integration deaktiviert.',
    es: 'El inicio de copias desde Gladys está desactivado en la configuración de la integración.',
  },
};

// The `sentence` output of "State of a client".
export const SENTENCE_TEXT = {
  en: { lastSuccess: (time) => `last backup ${time}`, never: 'never backed up' },
  fr: { lastSuccess: (time) => `dernière sauvegarde ${time}`, never: 'jamais sauvegardé' },
  de: { lastSuccess: (time) => `letzte Sicherung ${time}`, never: 'noch nie gesichert' },
  es: { lastSuccess: (time) => `última copia ${time}`, never: 'nunca copiado' },
};

export const LANGUAGE_FALLBACK = 'en';

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
const formats = new Map();

/**
 * A date as day/month hours:minutes, in the time zone of Gladys (the
 * supervisor injects TZ). Day and month: a weekly backup made six days ago
 * is not "today at 02:00".
 */
export function formatTime(time, language) {
  const locale = LOCALES[language] ?? LOCALES.en;
  if (!formats.has(locale)) {
    formats.set(
      locale,
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return formats.get(locale).format(new Date(time));
}

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is this client failed?" is already a scene condition on the device
// features. The reading action is about what a condition cannot do: put the
// state in a message ("laptop-anna: failed, last backup 18/10 02:05"). It
// reads UrBackup again when the last read is older than 15 seconds.
//
// "Start a backup" (an incremental file backup) can be disabled in the
// configuration: a scene, a voice assistant or another user of Gladys then
// cannot start one.
//
// Keys, outputs and behaviour are the ones of guim31/gladys-duplicati and
// gladys-kopia.
// -----------------------------------------------------------------------------

import { hoursSince, stateOf } from './devices.js';
import { SENTENCE_TEXT, STATE_TEXT, formatTime, labelled, pick } from './texts.js';

export const SCENE_ACTIONS = {
  async get_backup_status(hub, { fields = {} }) {
    const client = await hub.clientOf(fields.device);
    const language = hub.config.language;
    const stateText = pick(STATE_TEXT[stateOf(client)], language);
    const lastSuccess = client.lastSuccess === null ? '' : formatTime(client.lastSuccess, language);
    const words = SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;
    return {
      failed: client.lastRun?.result === 'error',
      overdue: client.overdue,
      online: client.online,
      state: stateText,
      name: client.name,
      last_success: lastSuccess,
      hours_since_success: hoursSince(client, hub.now()) ?? -1,
      sentence: `${labelled(client.name, stateText, language)}, ${
        lastSuccess ? words.lastSuccess(lastSuccess) : words.never
      }.`,
    };
  },

  async start_backup(hub, { fields = {} }) {
    await hub.startBackup(await hub.clientOf(fields.device));
  },
};

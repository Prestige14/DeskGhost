import notifier from 'node-notifier';
import { DeskGhostConfig } from '../config/types.js';

export class Notifier {
  private enabled: boolean;

  constructor(config: DeskGhostConfig) {
    this.enabled = config.notifications !== false;
  }

  notify(title: string, message: string): void {
    if (!this.enabled) return;

    try {
      notifier.notify({
        title: `👻 DeskGhost - ${title}`,
        message,
        sound: false,
        wait: false
      });
    } catch {
      // Desktop notifications fail silently if OS does not support them
    }
  }
}

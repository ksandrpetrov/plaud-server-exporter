export class TelegramError extends Error {
  constructor(message) {
    super(message);
    this.name = "TelegramError";
  }
}

const EventEmitter = require('events');

class RealtimeAdapter extends EventEmitter {
  constructor() {
    super();
    this.url = process.env.REALTIME_URL || '';
    this.key = process.env.REALTIME_KEY || '';
    this.connected = false;
  }

  async connect() {
    if (!this.url || !this.key) {
      console.warn('Realtime adapter not configured; skipping connect');
      return;
    }
    this.connected = true;
    console.log('Realtime adapter connected to', this.url);
  }

  async publish(channel, payload) {
    if (!this.connected) throw new Error('Realtime adapter not connected');
    console.log('Realtime publish', channel, payload);
  }

  async subscribe(channel, callback) {
    if (!this.connected) throw new Error('Realtime adapter not connected');
    console.log('Realtime subscribe', channel);
    this.on(channel, callback);
  }
}

function createRealtimeClient() {
  return new RealtimeAdapter();
}

module.exports = { createRealtimeClient };

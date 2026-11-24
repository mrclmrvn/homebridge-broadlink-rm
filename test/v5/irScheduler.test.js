const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { IRScheduler } = require('../../dist/helpers/irScheduler');
const { BaseAccessory } = require('../../dist/accessories/base');

test('grouped IR sends await the prior acknowledgement while other groups and RF can proceed', async () => {
  const scheduler = new IRScheduler(0, 0);
  const sent = [];
  let acknowledge;
  const ack = new Promise(resolve => { acknowledge = resolve; });
  const service = { setCharacteristic() { return this; } };
  function accessory(mac, group) {
    const platform = {
      irScheduler: scheduler,
      Service: {},
      Characteristic: {},
      log: { debug() {}, error() {} },
      deviceManager: { getDevice: () => ({
        macAddress: mac,
        async sendData(code) {
          sent.push([mac, code]);
          if (code === '2601') await ack;
        }
      }) }
    };
    return new BaseAccessory(platform, {
      UUID: mac, context: { config: { irDeviceGroup: group } }, getService: () => service,
    });
  }
  const first = accessory('a', 'room');
  const second = accessory('b', 'room');
  const third = accessory('c', 'upstairs');
  const firstSend = first.sendCode('2601');
  const secondSend = second.sendCode('0000 006D 0001 0000 0010 0020');
  await Promise.all([third.sendCode(Buffer.from('2603', 'hex')), second.sendCode('b204')]);
  assert.deepEqual(sent.map(([mac]) => mac).sort(), ['a', 'b', 'c']);
  assert.deepEqual(sent.find(([mac]) => mac === 'b'), ['b', 'b204']);
  acknowledge();
  await Promise.all([firstSend, secondSend]);
  assert.deepEqual(sent.at(-1), ['b', '0000 006D 0001 0000 0010 0020']);
});

test('IR scheduler enforces both cooldowns after completion and recovers after rejection', async () => {
  const scheduler = new IRScheduler(0.02, 0.03);
  const signal = new AbortController().signal;
  let failedAt;
  await assert.rejects(scheduler.send('a', 'room', signal, async () => {
    failedAt = performance.now();
    throw new Error('no reply');
  }), /no reply/);
  let repeatedAt;
  await scheduler.send('a', 'room', signal, async () => { repeatedAt = performance.now(); });
  assert.ok(repeatedAt - failedAt >= 20);
  await scheduler.send('b', 'room', signal, async () => {
    assert.ok(performance.now() - repeatedAt >= 30);
  });
});

test('cancelled queued IR commands never transmit or block subsequent commands', async () => {
  const scheduler = new IRScheduler(0, 0);
  const controller = new AbortController();
  let acknowledge;
  const ack = new Promise(resolve => { acknowledge = resolve; });
  const first = scheduler.send('a', 'room', new AbortController().signal, () => ack);
  const cancelled = scheduler.send('b', 'room', controller.signal, async () => assert.fail('cancelled command sent'));
  controller.abort();
  acknowledge();
  await first;
  await assert.rejects(cancelled, { name: 'AbortError' });
  await scheduler.send('b', 'room', new AbortController().signal, async () => {});
});

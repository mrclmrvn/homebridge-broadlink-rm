#!/usr/bin/env node
import { discoverDevices, RMDevice, getDeviceInfo } from './broadlink';
import { convertProntoCode } from './helpers/convertProntoCode';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`Broadlink RM CLI
Usage: node dist/cli.js <command>
  discover
  auth <ip> <mac> [devTypeHex]
  send <ip> <mac> <hexOrQuotedPronto> [devTypeHex]
  learn <ip> <mac> [devTypeHex]
  learn-rf <ip> <mac> [devTypeHex]
  sensors <ip> <mac> [devTypeHex]
  convert-pronto "0000 ..."
Device type defaults to 0x520b. Use the actual discovered type where possible.`);
    return;
  }
  if (command === 'convert-pronto') {
    if (args.length !== 2) throw new Error('Usage: convert-pronto "0000 ..."');
    console.log(convertProntoCode(args[1]));
    return;
  }
  if (command === 'discover') {
    const devices = await discoverDevices(4000);
    try {
      if (!devices.length) console.log('No Broadlink devices responded. Check local UDP discovery and network isolation, or try auth with the known IP, MAC and device type.');
      for (const item of devices) console.log(`${item.host} ${item.macAddress} 0x${item.devType.toString(16)} ${getDeviceInfo(item.devType).name}`);
    } finally { for (const item of devices) item.device.close(); }
    return;
  }
  if (!['auth', 'send', 'learn', 'learn-rf', 'sensors'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const sending = command === 'send';
  const expectedMin = sending ? 4 : 3;
  if (args.length < expectedMin || args.length > expectedMin + 1) {
    throw new Error(`Usage: ${command} <ip> <mac>${sending ? ' <hexOrQuotedPronto>' : ''} [devTypeHex]`);
  }
  const rawType = args[sending ? 4 : 3] || '0x520b';
  if (!/^(?:0x)?[0-9a-f]{1,4}$/i.test(rawType)) throw new Error('Invalid hexadecimal device type');
  const device = new RMDevice(args[1], args[2], parseInt(rawType.replace(/^0x/i, ''), 16));
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  try {
    switch (command) {
      case 'auth': await device.auth(controller.signal); console.log('Authentication successful.'); break;
      case 'send': await device.sendData(args[3]); console.log('Code sent.'); break;
      case 'learn': console.log('Press one IR remote button.'); console.log(await device.learnData(30000, 1000, controller.signal)); break;
      case 'learn-rf':
        console.log(await device.learnRFData({ signal: controller.signal, onProgress: stage => console.log(stage === 'frequency'
          ? 'Hold the RF remote button while the device searches for its frequency.' : 'Frequency found. Release and press the remote button to capture the code.') }));
        break;
      case 'sensors': console.log(JSON.stringify(await device.checkSensors())); break;
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
    device.close();
  }
}

if (require.main === module) {
  void main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

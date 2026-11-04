import { discoverDevices, RMDevice, getDeviceInfo } from './broadlink';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'discover': {
      console.log('🔍 Scanning local network for Broadlink devices...');
      const devices = await discoverDevices(4000);
      if (devices.length === 0) {
        console.log('No Broadlink devices responded to discovery broadcast.');
      } else {
        console.log(`\nFound ${devices.length} Broadlink device(s):`);
        for (const d of devices) {
          const info = getDeviceInfo(d.devType);
          console.log(` • [${info.name}] IP: ${d.host} | MAC: ${d.macAddress} | devType: 0x${d.devType.toString(16)} (isRM4: ${info.isRM4})`);
          d.device.close();
        }
      }
      break;
    }

    case 'auth': {
      const host = args[1];
      const mac = args[2];
      const devType = args[3] ? parseInt(args[3], 16) : 0x520b;

      if (!host || !mac) {
        console.error('Usage: cli auth <ip> <mac> [devTypeHex]');
        process.exit(1);
      }

      console.log(`Authenticating with ${host} (${mac}, devType: 0x${devType.toString(16)})...`);
      const device = new RMDevice(host, mac, devType);
      try {
        await device.auth();
        console.log('✅ Authentication successful! Session established.');
      } catch (err: any) {
        console.error('❌ Authentication failed:', err.message);
      } finally {
        device.close();
      }
      break;
    }

    case 'send': {
      const host = args[1];
      const mac = args[2];
      const hex = args[3];
      const devType = args[4] ? parseInt(args[4], 16) : 0x520b;

      if (!host || !mac || !hex) {
        console.error('Usage: cli send <ip> <mac> <hexCode> [devTypeHex]');
        process.exit(1);
      }

      console.log(`Sending code to ${host} (${mac})...`);
      const device = new RMDevice(host, mac, devType);
      try {
        await device.sendData(hex);
        console.log('✅ Code sent successfully!');
      } catch (err: any) {
        console.error('❌ Failed to send code:', err.message);
      } finally {
        device.close();
      }
      break;
    }

    case 'learn': {
      const host = args[1];
      const mac = args[2];
      const devType = args[3] ? parseInt(args[3], 16) : 0x520b;

      if (!host || !mac) {
        console.error('Usage: cli learn <ip> <mac> [devTypeHex]');
        process.exit(1);
      }

      console.log(`Entering IR learning mode on ${host} (${mac})...`);
      console.log('👉 Point your remote at the RM4 and press the button now...');
      const device = new RMDevice(host, mac, devType);
      try {
        const hex = await device.learnData(30000, 1000);
        console.log(`\n🎉 Code captured!\nHex: ${hex}\n`);
      } catch (err: any) {
        console.error('❌ Learning failed:', err.message);
      } finally {
        device.close();
      }
      break;
    }

    case 'sensors': {
      const host = args[1];
      const mac = args[2];
      const devType = args[3] ? parseInt(args[3], 16) : 0x520b;

      if (!host || !mac) {
        console.error('Usage: cli sensors <ip> <mac> [devTypeHex]');
        process.exit(1);
      }

      console.log(`Querying sensors on ${host} (${mac})...`);
      const device = new RMDevice(host, mac, devType);
      try {
        const reading = await device.checkSensors();
        console.log('📊 Sensor Reading:', reading);
      } catch (err: any) {
        console.error('❌ Failed to read sensors:', err.message);
      } finally {
        device.close();
      }
      break;
    }

    default:
      console.log(`
Broadlink RM TypeScript CLI

Usage:
  npx ts-node src/cli.ts discover
  npx ts-node src/cli.ts auth <ip> <mac> [devTypeHex]
  npx ts-node src/cli.ts send <ip> <mac> <hexCode> [devTypeHex]
  npx ts-node src/cli.ts learn <ip> <mac> [devTypeHex]
  npx ts-node src/cli.ts sensors <ip> <mac> [devTypeHex]
`);
  }
}

main().catch(console.error);


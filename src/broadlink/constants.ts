export const BROADLINK_PORT = 80;

export const INIT_KEY = Buffer.from('097628343fe99e23765c1513accf8b02', 'hex');
export const INIT_IV = Buffer.from('562e17996d093d28ddb3ba695a2e6f58', 'hex');

export const PACKET_HEADER_MAGIC = Buffer.from('5aa5aa555aa5aa55', 'hex');

export enum PacketCommand {
  DISCOVER = 0x06,
  AUTH = 0x65,
  COMMAND = 0x6a,
}

export enum RMSubCommand {
  SEND_DATA = 0x02,
  ENTER_LEARN = 0x03,
  CHECK_DATA = 0x04,
  CHECK_SENSORS = 0x01,
  CHECK_SENSORS_RM4 = 0x24,
  ENTER_RF_LEARN = 0x19,
  CHECK_RF_FREQUENCY = 0x1a,
  FIND_RF_PACKET = 0x1b,
  CANCEL_RF_LEARN = 0x1e,
}

export interface DeviceTypeInfo {
  name: string;
  isRM4: boolean;
  hasRF: boolean;
  hasSensors: boolean;
}

export const DEVICE_TYPES: Record<number, DeviceTypeInfo> = {
  // RM Mini / Mini 3
  0x27d0: { name: 'RM Mini 3', isRM4: false, hasRF: false, hasSensors: false },
  0x2714: { name: 'RM Mini', isRM4: false, hasRF: false, hasSensors: false },
  0x2737: { name: 'RM Mini 3 (v1)', isRM4: false, hasRF: false, hasSensors: false },
  0x278b: { name: 'RM Mini 3 (v2)', isRM4: false, hasRF: false, hasSensors: false },
  0x27c2: { name: 'RM Mini 3 (v3)', isRM4: false, hasRF: false, hasSensors: false },
  0x27c7: { name: 'RM Mini 3 (v4)', isRM4: false, hasRF: false, hasSensors: false },
  0x27de: { name: 'RM Mini 3 (v5)', isRM4: false, hasRF: false, hasSensors: false },

  // RM Pro / Pro+
  0x2712: { name: 'RM Pro', isRM4: false, hasRF: true, hasSensors: true },
  0x272a: { name: 'RM Pro', isRM4: false, hasRF: true, hasSensors: true },
  0x2787: { name: 'RM Pro+', isRM4: false, hasRF: true, hasSensors: false },
  0x279d: { name: 'RM Pro+ (v2)', isRM4: false, hasRF: true, hasSensors: false },
  0x27a9: { name: 'RM Pro+ (v3)', isRM4: false, hasRF: true, hasSensors: false },

  // RM4 Mini / RM4C Mini
  0x51da: { name: 'RM4 Mini', isRM4: true, hasRF: false, hasSensors: true },
  0x5209: { name: 'RM4C Mini', isRM4: true, hasRF: false, hasSensors: false },
  0x520c: { name: 'RM4 Mini', isRM4: true, hasRF: false, hasSensors: true },
  0x5211: { name: 'RM4C Mini', isRM4: true, hasRF: false, hasSensors: false },
  0x5212: { name: 'RM4 Mini', isRM4: true, hasRF: false, hasSensors: true },
  0x5216: { name: 'RM4 Mini', isRM4: true, hasRF: false, hasSensors: true },
  0x6070: { name: 'RM4C Mini', isRM4: true, hasRF: false, hasSensors: false },
  0x610e: { name: 'RM4 Mini', isRM4: true, hasRF: false, hasSensors: true },
  0x610f: { name: 'RM4C Mini', isRM4: true, hasRF: false, hasSensors: false },
  0x62bc: { name: 'RM4C Mini', isRM4: true, hasRF: false, hasSensors: false },
  0x648d: { name: 'RM4 Mini', isRM4: true, hasRF: false, hasSensors: true },
  0x649b: { name: 'RM4C Mini', isRM4: true, hasRF: false, hasSensors: false },
  0x6507: { name: 'RM4 Mini', isRM4: true, hasRF: false, hasSensors: true },
  0x6508: { name: 'RM4 Mini', isRM4: true, hasRF: false, hasSensors: true },

  // RM4 Pro
  0x520b: { name: 'RM4 Pro', isRM4: true, hasRF: true, hasSensors: true },
  0x5213: { name: 'RM4 Pro', isRM4: true, hasRF: true, hasSensors: true },
  0x5218: { name: 'RM4 Pro', isRM4: true, hasRF: true, hasSensors: true },
  0x644b: { name: 'RM4 Pro', isRM4: true, hasRF: true, hasSensors: true },
  0x644c: { name: 'RM4 Pro', isRM4: true, hasRF: true, hasSensors: true },
  0x644d: { name: 'RM4 Pro', isRM4: true, hasRF: true, hasSensors: true },
  0x6539: { name: 'RM4 Pro', isRM4: true, hasRF: true, hasSensors: true },
  0x653a: { name: 'RM4 Pro', isRM4: true, hasRF: true, hasSensors: true },
};

export function getDeviceInfo(devType: number): DeviceTypeInfo {
  if (DEVICE_TYPES[devType]) {
    return DEVICE_TYPES[devType];
  }

  // Fallback heuristic: IDs >= 0x5000 are typically RM4 series
  const isRM4 = devType >= 0x5000 && devType <= 0x6fff;
  return {
    name: `Unknown Broadlink (0x${devType.toString(16)})`,
    isRM4,
    hasRF: false,
    hasSensors: isRM4,
  };
}


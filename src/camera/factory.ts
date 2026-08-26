/** 設定に応じたカメラアダプタの生成。 */
import type { AppConfig } from '../config.js';
import { Gphoto2Camera } from './gphoto2/adapter.js';
import { MockCamera } from './mock.js';
import { PtpIpCamera } from './ptpip/adapter.js';
import { SdkBridgeCamera } from './sdkBridge.js';
import type { CameraAdapter } from './types.js';

export function createCamera(config: AppConfig, logger?: (msg: string) => void): CameraAdapter {
  switch (config.camera.transport) {
    case 'gphoto2': {
      const g = config.camera.gphoto2;
      return new Gphoto2Camera({
        binary: g.binary,
        mappingPath: g.mappingPath,
        alwaysRescan: g.alwaysRescan,
        timeoutMs: g.timeoutMs,
        ...(g.port ? { port: g.port } : {}),
        ...(logger ? { logger } : {}),
      });
    }
    case 'ptpip':
      return new PtpIpCamera({
        host: config.camera.host,
        port: config.camera.port,
        friendlyName: config.camera.friendlyName,
        dryRun: config.camera.dryRun,
        allowUnverified: config.camera.allowUnverified,
        propertyOverridePath: config.camera.propertyOverridePath,
        ...(logger ? { logger } : {}),
      });
    case 'sdk-bridge':
      return new SdkBridgeCamera({ baseUrl: config.camera.sdkBridgeUrl });
    case 'mock':
    default:
      return new MockCamera();
  }
}

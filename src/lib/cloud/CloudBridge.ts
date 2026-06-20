import { CloudProvider } from './CloudProvider';
import { PocketBaseBackend } from './PocketBaseProvider';

class CloudFactory {
  private pocketbaseInstance: CloudProvider | null = null;

  getProvider(): CloudProvider {
    if (!this.pocketbaseInstance) {
      this.pocketbaseInstance = new PocketBaseBackend();
    }
    return this.pocketbaseInstance;
  }
}

export const cloud = new CloudFactory();

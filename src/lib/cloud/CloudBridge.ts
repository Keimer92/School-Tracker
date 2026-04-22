import { CloudProvider } from './CloudProvider';
import { SupabaseBackend } from './SupabaseProvider';

class CloudFactory {
  private current: CloudProvider | null = null;

  getProvider(): CloudProvider {
    if (!this.current) {
      this.current = new SupabaseBackend();
    }
    return this.current;
  }
}

export const cloud = new CloudFactory();

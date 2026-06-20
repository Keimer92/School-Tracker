import { pb, reconnect as reconnectClient } from '../pocketbase';
import { CloudProvider, CloudUser } from './CloudProvider';
import { pocketbaseSyncService } from '../pocketbaseSyncService';
import { pocketbaseRealtimeService } from '../pocketbaseRealtimeService';

export class PocketBaseBackend implements CloudProvider {
  name: 'pocketbase' = 'pocketbase';

  async getUser(): Promise<CloudUser | null> {
    const model = pb.authStore.model;
    if (!model) return null;
    return { id: model.id, email: model.email as string };
  }

  onAuthStateChange(callback: (user: CloudUser | null) => void): () => void {
    const unsubscribe = pb.authStore.onChange((token, model) => {
      if (model) {
        callback({ id: model.id, email: model.email as string });
      } else {
        callback(null);
      }
    });
    return unsubscribe;
  }

  async signInWithGoogle(): Promise<void> {
    await pb.collection('users').authWithOAuth2({ provider: 'google' });
  }

  async signOut(): Promise<void> {
    pb.authStore.clear();
  }

  async checkHealth(): Promise<'online' | 'offline' | 'checking'> {
    try {
      const result = await pb.health.check();
      return result.code === 200 ? 'online' : 'offline';
    } catch {
      return 'offline';
    }
  }

  async pullAll(): Promise<any> {
    return pocketbaseSyncService.pullAll();
  }

  async pushAll(): Promise<void> {
    await pocketbaseSyncService.syncAll();
  }

  async reconnect(url: string): Promise<{ ok: boolean; latency: number }> {
    const result = await reconnectClient(url);
    const user = await this.getUser();
    if (user) {
      pocketbaseRealtimeService.restart(user.id);
    }
    return result;
  }
}

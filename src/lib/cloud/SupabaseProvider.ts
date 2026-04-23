import { supabase } from '../supabase';
import { CloudProvider, CloudUser } from './CloudProvider';

export class SupabaseBackend implements CloudProvider {
  name: 'supabase' = 'supabase';

  async getUser(): Promise<CloudUser | null> {
    const { data: { user } } = await supabase.auth.getUser();
    return user ? { id: user.id, email: user.email! } : null;
  }

  onAuthStateChange(callback: (user: CloudUser | null) => void): () => void {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      callback(user ? { id: user.id, email: user.email! } : null);
    });
    return () => subscription.unsubscribe();
  }



  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  }

  async checkHealth(): Promise<'online' | 'offline' | 'checking'> {
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`, {
        headers: { 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY }
      });
      return res.ok ? 'online' : 'offline';
    } catch {
      return 'offline';
    }
  }

  async pullAll(): Promise<any> {
    // Implementaremos esto después para centralizarlo
    console.log("Supabase pullAll no implementado aún en Provider");
    return null;
  }

  async pushAll(): Promise<void> {
    console.log("Supabase pushAll no implementado aún en Provider");
  }
}

export interface CloudUser {
  id: string;
  email: string;
}

export interface CloudProvider {
  name: 'supabase';
  
  getUser(): Promise<CloudUser | null>;
  onAuthStateChange(callback: (user: CloudUser | null) => void): () => void;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  checkHealth(): Promise<'online' | 'offline' | 'checking'>;
  
  // Métodos de sincronización masiva
  pullAll(): Promise<any>;
  pushAll(): Promise<void>;
}

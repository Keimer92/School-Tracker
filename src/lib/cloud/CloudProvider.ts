// Definiremos un tipo User genérico para que ambos hablen lo mismo
export interface CloudUser {
  id: string;
  email: string;
  name?: string;
}

export interface CloudProvider {
  name: 'supabase' | 'appwrite';
  
  // Auth
  getUser(): Promise<CloudUser | null>;
  onAuthStateChange(callback: (user: CloudUser | null) => void): () => void;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;

  // Opcional: Lógica específica cuando el flujo OAuth necesita procesar tokens devueltos
  // Appwrite usa esto para establecer la sesión desde secret y userId
  finishOAuthLogin?(userId: string, secret: string): Promise<void>;

  // Sync / Data Operations
  // Aquí definiremos los métodos que syncService.ts llamará
  pullAll(): Promise<any>;
  pushAll(): Promise<void>;
  
  // Verificación de Salud
  checkHealth(): Promise<'online' | 'offline' | 'checking'>;
}

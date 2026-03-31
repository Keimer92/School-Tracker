import { CloudProvider } from './CloudProvider';
import { getSelectedProvider } from './config';
// Estos proveedores los crearemos a continuación
import { SupabaseBackend } from './SupabaseProvider';
import { AppwriteBackend } from './AppwriteProvider';

class CloudFactory {
  private current: CloudProvider | null = null;

  getProvider(): CloudProvider {
    const selected = getSelectedProvider();
    
    // Si ya lo tenemos y es el mismo, lo devolvemos
    if (this.current && this.current.name === selected) {
      return this.current;
    }

    // Si no, instanciamos el correcto
    this.current = selected === 'supabase' ? new SupabaseBackend() : new AppwriteBackend();
    return this.current;
  }
}

export const cloud = new CloudFactory();

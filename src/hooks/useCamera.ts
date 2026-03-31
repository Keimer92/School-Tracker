import { useState, useRef } from 'react';

/**
 * Hook para manejar la captura de fotos con cámara en móvil
 * Usa input file con capture para abrir la cámara nativa del dispositivo
 */
export function useCamera() {
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Abre el selector de archivos/cámara
   */
  const openCamera = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  /**
   * Maneja el cambio en el input file
   * Convierte la imagen a base64 para guardarla
   */
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validar que sea una imagen
    if (!file.type.startsWith('image/')) {
      alert('Por favor selecciona una imagen válida');
      return;
    }

    setTakingPhoto(true);

    try {
      // Leer archivo como base64
      const base64 = await fileToBase64(file);
      setPhotoPreview(base64 as string);
    } catch (error) {
      console.error('Error al procesar imagen:', error);
      alert('Error al procesar la imagen');
    } finally {
      setTakingPhoto(false);
      // Resetear el input para permitir seleccionar la misma imagen nuevamente
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  /**
   * Convierte un File a base64
   */
  const fileToBase64 = (file: File): Promise<string | ArrayBuffer | null> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = () => {
        // Comprimir imagen si es muy grande
        const result = reader.result as string;
        if (result.length > 500000) { // Más de ~500KB
          compressImage(result, resolve);
        } else {
          resolve(result);
        }
      };
      
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  /**
   * Comprime una imagen base64 reduciendo su calidad
   */
  const compressImage = (base64: string, resolve: (value: string | ArrayBuffer | null) => void) => {
    const img = new Image();
    img.src = base64;
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Redimensionar si es muy grande (max 800px)
      let width = img.width;
      let height = img.height;
      const maxWidth = 800;
      
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        // Comprimir a calidad 0.7
        const compressed = canvas.toDataURL('image/jpeg', 0.7);
        resolve(compressed);
      } else {
        resolve(base64);
      }
    };
    
    img.onerror = () => resolve(base64);
  };

  /**
   * Limpia la foto seleccionada
   */
  const clearPhoto = () => {
    setPhotoPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return {
    takingPhoto,
    photoPreview,
    openCamera,
    clearPhoto,
    setPhotoPreview,
    fileInputRef,
    handleFileChange,
  };
}

// Prepara una foto antes de subirla: la achica para que no ocupe de más.
// Una foto de celular (4000 px, 5 MB) queda en 1600 px y unos cientos de KB, que en
// pantalla se ve igual. Los GIF se suben tal cual, para no perder la animación.

const MAX_SIDE = 1600;
const QUALITY = 0.85;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // el mismo límite que el servidor

export async function prepareImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" no es una imagen`);
  if (file.type === 'image/gif') return checkSize(file);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // El navegador no la sabe abrir (por ejemplo, HEIC de iPhone en una compu): se intenta tal cual
    return checkSize(file);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  // Fondo blanco: las capturas PNG con partes transparentes no quedan negras en JPG
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  // Si por algún motivo achicarla no la hizo más liviana, se sube la original
  return checkSize(blob && blob.size < file.size ? blob : file);
}

function checkSize(blob: Blob): Blob {
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('La foto es demasiado grande (máximo 8 MB)');
  return blob;
}

// Fotos de cada operación: capturas del gráfico, de una noticia, del broker, etc.
//
// La imagen se guarda como archivo en data/fotos (con un nombre al azar) y en la base
// queda solo una fila con el nombre del archivo, la operación y el usuario. Así la base
// no crece con imágenes y un usuario nunca puede ver las fotos de otro.
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { all, dataDir, get, run } from '../db.ts';
import { HttpError } from '../util.ts';

// Ruta absoluta: el servidor la necesita así para mandar el archivo
const DIR = resolve(dataDir, 'fotos');
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_OPERATION = 10;

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' } as const;
type ImageType = keyof typeof TYPES;

/**
 * Qué tipo de imagen es, mirando sus primeros bytes (no el nombre ni lo que dice el navegador).
 * Si no es una imagen de verdad, devuelve null: así nadie puede subir otra cosa disfrazada de foto.
 */
export function detectImageType(buf: Uint8Array): ImageType | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  const text = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length > 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export interface ImageRow {
  id: number;
  operation_id: number;
  user_id: number;
  file: string;
  mime: string;
  created_at: string;
}

export function listImages(userId: number, operationId: number): { id: number; created_at: string }[] {
  return all('SELECT id, created_at FROM operation_images WHERE user_id = ? AND operation_id = ? ORDER BY id', userId, operationId);
}

/** Cuántas fotos tiene cada operación del usuario (para marcarlas en el historial). */
export function imageCounts(userId: number): Map<number, number> {
  const rows = all<{ operation_id: number; n: number }>(
    'SELECT operation_id, COUNT(*) AS n FROM operation_images WHERE user_id = ? GROUP BY operation_id',
    userId,
  );
  return new Map(rows.map((r) => [r.operation_id, r.n]));
}

/** La primera foto de cada operación del usuario (para mostrarla en miniatura en el gráfico). */
export function firstImageIds(userId: number): Map<number, number> {
  const rows = all<{ operation_id: number; id: number }>('SELECT operation_id, MIN(id) AS id FROM operation_images WHERE user_id = ? GROUP BY operation_id', userId);
  return new Map(rows.map((r) => [r.operation_id, r.id]));
}

export function addImage(userId: number, operationId: number, data: Uint8Array): number {
  if (!get('SELECT 1 FROM operations WHERE id = ? AND user_id = ?', operationId, userId)) throw new HttpError(404, 'Operación no encontrada');
  if (data.length === 0) throw new HttpError(400, 'La foto está vacía');
  if (data.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'La foto es demasiado grande (máximo 8 MB)');
  const mime = detectImageType(data);
  if (!mime) throw new HttpError(415, 'El archivo no es una imagen (se aceptan JPG, PNG, GIF y WEBP)');
  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM operation_images WHERE operation_id = ?', operationId)!.n;
  if (count >= MAX_IMAGES_PER_OPERATION) throw new HttpError(409, `Cada operación puede tener hasta ${MAX_IMAGES_PER_OPERATION} fotos`);

  mkdirSync(DIR, { recursive: true });
  const file = `${randomUUID()}.${TYPES[mime]}`;
  writeFileSync(join(DIR, file), data);
  return Number(
    run('INSERT INTO operation_images (operation_id, user_id, file, mime) VALUES (?, ?, ?, ?)', operationId, userId, file, mime).lastInsertRowid,
  );
}

/** Dónde está el archivo de una foto, solo si es del usuario. */
export function imageFile(userId: number, imageId: number): { path: string; mime: string } {
  const row = get<ImageRow>('SELECT * FROM operation_images WHERE id = ? AND user_id = ?', imageId, userId);
  if (!row) throw new HttpError(404, 'Foto no encontrada');
  return { path: join(DIR, row.file), mime: row.mime };
}

export function deleteImage(userId: number, imageId: number): void {
  const row = get<ImageRow>('SELECT * FROM operation_images WHERE id = ? AND user_id = ?', imageId, userId);
  if (!row) throw new HttpError(404, 'Foto no encontrada');
  run('DELETE FROM operation_images WHERE id = ?', imageId);
  rmSync(join(DIR, row.file), { force: true });
}

/**
 * Borra los archivos de las fotos de esas operaciones. Se llama ANTES de borrar las
 * operaciones: las filas se van solas con ellas (ON DELETE CASCADE), pero los archivos no.
 */
export function deleteImagesOf(operationIds: number[]): void {
  for (const id of operationIds) {
    for (const r of all<{ file: string }>('SELECT file FROM operation_images WHERE operation_id = ?', id)) {
      rmSync(join(DIR, r.file), { force: true });
    }
    run('DELETE FROM operation_images WHERE operation_id = ?', id);
  }
}

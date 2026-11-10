// Fotos de las operaciones: solo imágenes de verdad, cada una de su dueño, y que se borren bien.
import './helpers.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { all, run } from '../src/db.ts';
import { addImage, deleteImage, deleteImagesOf, detectImageType, imageFile, listImages } from '../src/services/images.ts';

// Los primeros bytes de cada formato (alcanza para reconocerlos)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
const status = (code: number) => (e: { status: number }) => e.status === code;

run("INSERT INTO users (id, name, email, password_hash) VALUES (1, 'Ana', 'ana@test.com', 'x'), (2, 'Beto', 'beto@test.com', 'x')");
run("INSERT INTO assets (ticker, symbol, name, type) VALUES ('AAA', 'AAA.BA', 'Prueba', 'ACCION')");
const newOp = (user: number) =>
  Number(run("INSERT INTO operations (user_id, ticker, type, date, quantity, price) VALUES (?, 'AAA', 'COMPRA', '2025-01-02', 1, 100)", user).lastInsertRowid);

describe('Reconocer imágenes', () => {
  test('reconoce PNG, JPG y WEBP por su contenido', () => {
    assert.equal(detectImageType(PNG), 'image/png');
    assert.equal(detectImageType(JPG), 'image/jpeg');
    assert.equal(detectImageType(WEBP), 'image/webp');
  });

  test('un archivo que no es imagen no pasa, aunque se llame "foto.png"', () => {
    assert.equal(detectImageType(new TextEncoder().encode('<script>alert(1)</script>')), null);
  });
});

describe('Subir, ver y borrar', () => {
  const op = newOp(1);

  test('se guarda la foto y queda el archivo', () => {
    const id = addImage(1, op, PNG);
    assert.deepEqual(listImages(1, op).map((i) => i.id), [id]);
    const { path, mime } = imageFile(1, id);
    assert.equal(mime, 'image/png');
    assert.ok(existsSync(path));
  });

  test('otra persona no puede ver ni borrar tus fotos', () => {
    const [{ id }] = listImages(1, op);
    assert.throws(() => imageFile(2, id), status(404));
    assert.throws(() => deleteImage(2, id), status(404));
    assert.throws(() => addImage(2, op, PNG), status(404)); // ni agregarle fotos a tu operación
  });

  test('rechaza archivos que no son imágenes', () => {
    assert.throws(() => addImage(1, op, new TextEncoder().encode('hola')), status(415));
  });

  test('máximo 10 fotos por operación', () => {
    for (let i = listImages(1, op).length; i < 10; i++) addImage(1, op, JPG);
    assert.throws(() => addImage(1, op, JPG), status(409));
  });

  test('borrar una foto borra también su archivo', () => {
    const [{ id }] = listImages(1, op);
    const { path } = imageFile(1, id);
    deleteImage(1, id);
    assert.ok(!existsSync(path));
    assert.equal(listImages(1, op).length, 9);
  });
});

describe('Al borrar la operación', () => {
  test('se borran sus fotos y sus archivos', () => {
    const op = newOp(1);
    const id = addImage(1, op, PNG);
    const { path } = imageFile(1, id);
    deleteImagesOf([op]);
    run('DELETE FROM operations WHERE id = ?', op);
    assert.ok(!existsSync(path));
    assert.equal(all('SELECT 1 FROM operation_images WHERE operation_id = ?', op).length, 0);
  });
});

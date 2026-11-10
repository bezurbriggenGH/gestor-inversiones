import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, imageUrl, type OperationImage } from '../api';
import { DATA_KEYS } from '../hooks';
import { prepareImage } from '../images';
import { Button, ErrorBox, Modal } from './ui';

const MAX_PHOTOS = 10; // el mismo límite que el servidor

/** Fotos de una operación: capturas del gráfico, de una noticia o del broker. */
export function OperationPhotos({ operationId, images }: { operationId: number; images: OperationImage[] }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const refresh = () => DATA_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
  const left = MAX_PHOTOS - images.length;

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      if (files.length > left) throw new Error(`Podés agregar ${left} foto${left === 1 ? '' : 's'} más (máximo ${MAX_PHOTOS} por operación)`);
      // De a una, para que si una falla las anteriores ya queden guardadas
      for (const f of files) await api.addImage(operationId, await prepareImage(f));
    },
    onSettled: refresh,
  });

  const remove = useMutation({ mutationFn: api.deleteImage, onSuccess: refresh });

  // Pegar una captura con Ctrl+V mientras se ve la operación
  const uploadFiles = useRef(upload.mutate);
  uploadFiles.current = upload.mutate;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea')) return; // pegando texto en un campo: no es una foto
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        uploadFiles.current(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-medium">
          Fotos {images.length > 0 && <span className="text-sm text-muted">({images.length})</span>}
        </h2>
        {left > 0 && (
          <Button onClick={() => input.current?.click()} disabled={upload.isPending} className="shrink-0 text-xs">
            {upload.isPending ? 'Subiendo…' : 'Agregar fotos'}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = ''; // para poder volver a elegir la misma foto
            if (files.length) upload.mutate(files);
          }}
        />
      </div>

      {images.length === 0 ? (
        <p className="text-sm text-muted">
          Guardá capturas del gráfico, de una noticia o del comprobante del broker. También podés pegar una captura con Ctrl+V.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {images.map((img, i) => (
            <div key={img.id} className="group relative aspect-square overflow-hidden rounded-lg bg-card">
              <button onClick={() => setOpen(i)} className="h-full w-full" aria-label={`Ver foto ${i + 1}`}>
                <img src={imageUrl(img.id)} alt={`Foto ${i + 1} de la operación`} loading="lazy" className="h-full w-full object-cover transition group-hover:opacity-90" />
              </button>
              <button
                onClick={() => window.confirm('¿Borrar esta foto?') && remove.mutate(img.id)}
                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-xs text-white opacity-100 transition hover:bg-down sm:opacity-0 sm:group-hover:opacity-100"
                aria-label={`Borrar foto ${i + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <ErrorBox error={upload.error ?? remove.error} />

      {open != null && images[open] && (
        <Modal title={`Foto ${open + 1} de ${images.length}`} onClose={() => setOpen(null)}>
          <div className="flex flex-col gap-3">
            <a href={imageUrl(images[open].id)} target="_blank" rel="noreferrer" title="Abrir en tamaño completo">
              <img src={imageUrl(images[open].id)} alt={`Foto ${open + 1} de la operación`} className="max-h-[65vh] w-full rounded-lg object-contain" />
            </a>
            {images.length > 1 && (
              <div className="flex justify-between">
                <Button onClick={() => setOpen((open - 1 + images.length) % images.length)}>← Anterior</Button>
                <Button onClick={() => setOpen((open + 1) % images.length)}>Siguiente →</Button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

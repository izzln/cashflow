import { attachmentStore } from './attachments';
import type { Attachment } from './model';

/**
 * Small previews of attached images and PDFs (first page), shown in Files cells at row height.
 * New uploads get one stored on the attachment (`thumb`); files attached before that get one made on
 * first view, kept for this device only. PDFs are drawn by pdf.js, loaded only when one is needed.
 */

const HEIGHT = 64;
const MAX_WIDTH = 160;
const CACHE = 'cashflow-allseeing.athumb.';

export const isImage = (a: Pick<Attachment, 'type' | 'name'>) =>
  /^image\/(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(a.type) || /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(a.name);

export const isPdf = (a: Pick<Attachment, 'type' | 'name'>) => /^application\/pdf$/i.test(a.type) || /\.pdf$/i.test(a.name);

/** Whether a preview can be made for this file. */
export const hasPreview = (a: Pick<Attachment, 'type' | 'name'>) => isImage(a) || isPdf(a);

/** A JPEG data URL of an image or a PDF's first page, or undefined if the file can't be read. */
export async function makeThumb(blob: Blob, a: Pick<Attachment, 'type' | 'name'>): Promise<string | undefined> {
  return isPdf(a) ? pdfThumb(blob) : imageThumb(blob);
}

function toJpeg(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void | Promise<void>) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#fff'; // JPEG has no transparency; PDF pages are white
  ctx.fillRect(0, 0, w, h);
  return Promise.resolve(draw(ctx, canvas)).then(() => canvas.toDataURL('image/jpeg', 0.72));
}

/** The first page of a PDF, HEIGHT px tall. */
async function pdfThumb(blob: Blob): Promise<string | undefined> {
  try {
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    }
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useWasm: false });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(HEIGHT / base.height, MAX_WIDTH / base.width);
      const viewport = page.getViewport({ scale });
      return await toJpeg(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)), async (ctx, canvas) => {
        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      });
    } finally {
      void task.destroy();
    }
  } catch {
    return undefined;
  }
}

/** An image HEIGHT px tall (smaller images keep their size). */
async function imageThumb(blob: Blob): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, HEIGHT / bmp.height, MAX_WIDTH / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const url = await toJpeg(w, h, (ctx) => ctx.drawImage(bmp, 0, 0, w, h));
    bmp.close?.();
    return url;
  } catch {
    return undefined;
  }
}

/** Previews made on this device for files attached before previews existed. */
export const lazyThumbs = $state<Record<string, string>>({});
const pending = new Set<string>();

/** The preview to show for an attachment, starting to make one if it can have one but has none. */
export function thumbFor(fileId: string | undefined, a: Attachment): string | undefined {
  if (a.thumb) return a.thumb;
  if (lazyThumbs[a.id]) return lazyThumbs[a.id];
  if (!fileId || !hasPreview(a) || pending.has(a.id)) return undefined;
  pending.add(a.id);
  void (async () => {
    try {
      const cached = localStorage.getItem(CACHE + a.id);
      if (cached) {
        lazyThumbs[a.id] = cached;
        return;
      }
    } catch {
      // No storage: make it each session.
    }
    try {
      const res = await fetch(await attachmentStore.url(fileId, a), { credentials: 'same-origin' });
      if (!res.ok) return;
      const t = await makeThumb(await res.blob(), a);
      if (!t) return;
      lazyThumbs[a.id] = t;
      try {
        localStorage.setItem(CACHE + a.id, t);
      } catch {
        // Storage full: fine.
      }
    } catch {
      // Offline: try again next time.
    }
  })();
  return undefined;
}

/** A short type label for files without a preview: "PDF", "XLSX", "DOC"… */
export function fileKind(name: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1];
  return ext ? ext.toUpperCase().slice(0, 4) : 'FILE';
}

import { attachmentStore } from './attachments';
import type { Attachment } from './model';

/**
 * Small previews of attached images, shown in Files cells at row height.
 * New uploads get one stored on the attachment (`thumb`); images attached before that get one made on
 * first view, kept for this device only.
 */

const HEIGHT = 64;
const MAX_WIDTH = 160;
const CACHE = 'cashflow-allseeing.athumb.';

export const isImage = (a: Pick<Attachment, 'type' | 'name'>) =>
  /^image\/(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(a.type) || /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(a.name);

/** A JPEG data URL HEIGHT px tall (smaller images keep their size), or undefined if the image can't be read. */
export async function makeThumb(blob: Blob): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, HEIGHT / bmp.height, MAX_WIDTH / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return undefined;
  }
}

/** Previews made on this device for images attached before previews existed. */
export const lazyThumbs = $state<Record<string, string>>({});
const pending = new Set<string>();

/** The preview to show for an attachment, starting to make one if it is an image without it. */
export function thumbFor(fileId: string | undefined, a: Attachment): string | undefined {
  if (a.thumb) return a.thumb;
  if (lazyThumbs[a.id]) return lazyThumbs[a.id];
  if (!fileId || !isImage(a) || pending.has(a.id)) return undefined;
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
      const t = await makeThumb(await res.blob());
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

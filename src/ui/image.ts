// Images are private Drive files. The script returns them as base64 after an
// access check, and they are shown from a data: URL.
import { api } from '../api';
import { h, replace } from '../dom';
import { errorBox, loading } from './components';

export function remoteImage(action: string, payload: unknown, alt: string): HTMLElement {
  const box = h('figure', { class: 'chart-image' });
  replace(box, loading('Loading image…'));
  api<{ mimeType: string; base64: string }>(action, payload).then(
    (img) => {
      // Only ever build data: URLs for PNG/JPEG with plain base64 content.
      if (
        !['image/png', 'image/jpeg'].includes(img.mimeType) ||
        !/^[A-Za-z0-9+/=]+$/.test(img.base64)
      ) {
        replace(box, errorBox(new Error('The image could not be shown.')));
        return;
      }
      const src = `data:${img.mimeType};base64,${img.base64}`;
      replace(
        box,
        h('img', { src, alt }),
        h(
          'figcaption',
          null,
          h(
            'a',
            { href: src, download: `chart.${img.mimeType === 'image/png' ? 'png' : 'jpg'}` },
            'Download chart image',
          ),
        ),
      );
    },
    (err) => replace(box, errorBox(err)),
  );
  return box;
}

export interface PickedImage {
  base64: string;
  mimeType: string;
  name: string;
}

/** Read a chosen file as base64 after checking type and size in the browser too. */
export function readImageFile(file: File): Promise<PickedImage> {
  return new Promise((resolve, reject) => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      reject(new Error('The chart image must be a PNG or JPG file.'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('The chart image must be 5 MB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.onload = () => {
      const url = String(reader.result);
      resolve({ base64: url.slice(url.indexOf(',') + 1), mimeType: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  });
}

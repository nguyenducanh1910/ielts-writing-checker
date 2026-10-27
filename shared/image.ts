import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from './constants';

/** Decoded size of a base64 string, in bytes. */
export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/\s/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

/** Identify PNG or JPEG from the first bytes of base64 data. */
export function sniffImageMime(b64: string): 'image/png' | 'image/jpeg' | null {
  if (b64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  return null;
}

/** Returns an error message, or null when the image is acceptable. */
export function checkImage(input: { base64: string; mimeType: string }): string | null {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return 'The chart image must be a PNG or JPG file.';
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) return 'The image data is not valid.';
  if (base64ByteLength(input.base64) > MAX_IMAGE_BYTES) {
    return 'The chart image must be 5 MB or smaller.';
  }
  const sniffed = sniffImageMime(input.base64);
  if (!sniffed || sniffed !== input.mimeType) return 'The file is not a valid PNG or JPG image.';
  return null;
}

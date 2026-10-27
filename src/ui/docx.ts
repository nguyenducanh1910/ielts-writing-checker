// Reads the plain text of a .docx file in the browser, without a library:
// a .docx is a ZIP archive whose main text is in word/document.xml.

function u16(b: Uint8Array, i: number) {
  return b[i] | (b[i + 1] << 8);
}
function u32(b: Uint8Array, i: number) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Return the uncompressed bytes of one file inside a ZIP archive, or null. */
export async function readZipEntry(zip: Uint8Array, name: string): Promise<Uint8Array | null> {
  // End of central directory record: search backwards for its signature.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a valid .docx document.');
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(zip, p) !== 0x02014b50) break;
    const method = u16(zip, p + 10);
    const size = u32(zip, p + 20);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const local = u32(zip, p + 42);
    const entryName = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (entryName === name) {
      const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error('This .docx uses an unsupported compression method.');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Plain text from WordprocessingML: one paragraph per <w:p>, blank line between paragraphs. */
export function documentXmlToText(xml: string): string {
  const body = xml.replace(/<w:(?:del|instrText)\b[\s\S]*?<\/w:(?:del|instrText)>/g, '');
  const paragraphs = body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? [];
  const lines = paragraphs.map((p) => {
    let out = '';
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
    for (let m = re.exec(p); m; m = re.exec(p)) {
      if (m[1] !== undefined) out += decodeXml(m[1]);
      else if (m[0] === '<w:tab/>') out += '\t';
      else out += '\n';
    }
    return out.trimEnd();
  });
  return lines
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function docxToText(bytes: Uint8Array): Promise<string> {
  const xml = await readZipEntry(bytes, 'word/document.xml');
  if (!xml) throw new Error('No document text was found in this .docx file.');
  return documentXmlToText(new TextDecoder().decode(xml));
}

/** Text from a .txt or .docx file chosen by the user. */
export async function readEssayFile(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('The file is larger than 10 MB.');
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.txt')) return (await file.text()).replace(/\r\n/g, '\n').trim();
  if (lower.endsWith('.docx')) return docxToText(new Uint8Array(await file.arrayBuffer()));
  if (lower.endsWith('.doc')) {
    throw new Error('Old .doc files are not supported. In Word, use File → Save As → .docx.');
  }
  throw new Error('Choose a .txt or .docx file.');
}

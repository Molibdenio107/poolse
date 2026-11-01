/**
 * One page of paper as a JPEG — POOLSE-142. A club's boletim arrives as a
 * scanned PDF or a photograph; it is stored as an image so the editor, the print
 * and the AI reader all read one thing. Runs in the browser only (pdf.js and a
 * canvas), before the upload.
 *
 * About 200 dpi across an A4 width: sharp enough to print a form's printed
 * lines, small enough (a few hundred KB) to stay well under the 10 MB ceiling.
 * A transparent PNG is laid on white, because a form's paper is white.
 */
const WIDTH = 1654;

export interface PageImage {
  blob: Blob;
  /** Pages in the PDF; only the first was taken. 1 for an image. */
  pages: number;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob === null ? reject(new Error('canvas')) : resolve(blob)), 'image/jpeg', 0.88),
  );
}

function whiteCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('canvas');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return [canvas, context];
}

async function pdfFirstPage(file: File): Promise<PageImage> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: WIDTH / natural.width });
    const [canvas, context] = whiteCanvas(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return { blob: await canvasToJpeg(canvas), pages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}

async function photo(file: File): Promise<PageImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, WIDTH / bitmap.width);
    const [canvas, context] = whiteCanvas(bitmap.width * scale, bitmap.height * scale);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { blob: await canvasToJpeg(canvas), pages: 1 };
  } finally {
    bitmap.close();
  }
}

/** The file's first page as a JPEG, or a thrown error for something that is neither PDF nor image. */
export async function pageImage(file: File): Promise<PageImage> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return pdfFirstPage(file);
  if (file.type.startsWith('image/')) return photo(file);
  throw new Error('type');
}

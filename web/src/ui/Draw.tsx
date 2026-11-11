import { useEffect, useRef } from 'preact/hooks';
import { IconUndo } from './icons';

type Stroke = Array<[number, number]>;

/**
 * A drawing pad. Drawing is a recognised way to get a word across when it will not come.
 * `onChange` gets a small PNG (base64) a moment after each stroke, or null when the pad is empty.
 */
export function DrawPad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const timer = useRef<number>(0);

  const W = 640, H = 420;

  function paint() {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#16191c';
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of [...strokes.current, ...(current.current ? [current.current] : [])]) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      if (s.length === 1) g.lineTo(s[0][0] + 0.1, s[0][1] + 0.1);
      g.stroke();
    }
  }

  function emit(delay: number) {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!strokes.current.length) return onChange(null);
      onChange(ref.current!.toDataURL('image/png').split(',')[1]);
    }, delay);
  }

  useEffect(() => { paint(); return () => clearTimeout(timer.current); }, []);

  const at = (e: PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  return (
    <div class="pad">
      <canvas ref={ref} width={W} height={H} class="pad-canvas" role="img" aria-label="Drawing area. Draw the thing you mean."
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); current.current = [at(e)]; clearTimeout(timer.current); paint(); }}
        onPointerMove={(e) => { if (!current.current) return; current.current.push(at(e)); paint(); }}
        onPointerUp={() => { if (!current.current) return; strokes.current.push(current.current); current.current = null; paint(); emit(900); }}
        onPointerCancel={() => { current.current = null; paint(); }}
      />
      <div class="pad-tools">
        <button class="btn btn-quiet" onClick={() => { strokes.current.pop(); paint(); emit(300); }}><IconUndo /> Undo</button>
        <button class="btn btn-quiet" onClick={() => { strokes.current = []; paint(); emit(0); }}>Clear</button>
      </div>
    </div>
  );
}

/** Shrink a photo so it is quick to read on the device. Returns base64 JPEG. */
export async function photoToJpeg(file: File, max = 768): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88).split(',')[1];
}

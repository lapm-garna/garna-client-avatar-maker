"use client";

import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type LayoutMode = "flow" | "split" | "diagonal" | "wave";
type LogoAsset = { image: HTMLImageElement; name: string; url: string };
type Point = { x: number; y: number };
type LogoKey = "one" | "two";

const SIZE = 1024;

const layouts: Array<{ id: LayoutMode; title: string }> = [
  { id: "flow", title: "Поток" },
  { id: "split", title: "Сплит" },
  { id: "diagonal", title: "Диагональ" },
  { id: "wave", title: "Волнистая диагональ" },
];

function getLogoCenters(mode: LayoutMode, offsetOne: Point = { x: 0, y: 0 }, offsetTwo: Point = { x: 0, y: 0 }) {
  const base = mode === "diagonal" || mode === "wave"
    ? { one: { x: 315, y: 415 }, two: { x: 710, y: 610 } }
    : { one: { x: 333, y: 512 }, two: { x: 704, y: 512 } };

  return {
    one: { x: base.one.x + offsetOne.x, y: base.one.y + offsetOne.y },
    two: { x: base.two.x + offsetTwo.x, y: base.two.y + offsetTwo.y },
  };
}

function imageFromUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas export failed"));
    }, "image/png");
  });
}

async function removeFlatBackground(source: HTMLImageElement, name: string): Promise<LogoAsset> {
  const maxSide = 1600;
  const ratio = Math.min(1, maxSide / Math.max(source.naturalWidth, source.naturalHeight));
  const width = Math.max(1, Math.round(source.naturalWidth * ratio));
  const height = Math.max(1, Math.round(source.naturalHeight * ratio));
  const work = document.createElement("canvas");
  work.width = width;
  work.height = height;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(source, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const patch = Math.max(2, Math.floor(Math.min(width, height) * 0.035));
  const corners = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];

  const samples = corners.map(([startX, startY]) => {
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let y = startY; y < startY + patch; y += 1) {
      for (let x = startX; x < startX + patch; x += 1) {
        const offset = (y * width + x) * 4;
        if (pixels[offset + 3] < 180) continue;
        red += pixels[offset];
        green += pixels[offset + 1];
        blue += pixels[offset + 2];
        count += 1;
      }
    }
    return count ? [red / count, green / count, blue / count] : [255, 255, 255];
  });

  const colorDistance = (offset: number) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const sample of samples) {
      const red = pixels[offset] - sample[0];
      const green = pixels[offset + 1] - sample[1];
      const blue = pixels[offset + 2] - sample[2];
      nearest = Math.min(nearest, Math.sqrt(red * red + green * green + blue * blue));
    }
    return nearest;
  };

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const threshold = 112;
  const enqueue = (index: number) => {
    if (visited[index]) return;
    const offset = index * 4;
    if (pixels[offset + 3] > 24 && colorDistance(offset) > threshold) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < visited.length; index += 1) {
    const offset = index * 4;
    if (visited[index]) {
      const distance = colorDistance(offset);
      const matte = Math.max(0, Math.min(1, (distance - 24) / (threshold - 24)));
      pixels[offset + 3] = Math.round(pixels[offset + 3] * matte);
    }
    if (pixels[offset + 3] > 8) {
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) throw new Error("Logo disappeared");
  ctx.putImageData(imageData, 0, 0);
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const padding = Math.max(8, Math.round(Math.max(cropWidth, cropHeight) * 0.055));
  const output = document.createElement("canvas");
  output.width = cropWidth + padding * 2;
  output.height = cropHeight + padding * 2;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("Canvas unavailable");
  outputContext.drawImage(work, minX, minY, cropWidth, cropHeight, padding, padding, cropWidth, cropHeight);

  const blob = await canvasToBlob(output);
  const url = URL.createObjectURL(blob);
  const image = await imageFromUrl(url);
  return { image, name, url };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  asset: LogoAsset | null,
  cx: number,
  cy: number,
  box: number,
  label: string,
  card: boolean,
) {
  if (card) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.14)";
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 14;
    roundRect(ctx, cx - box / 2, cy - box / 2, box, box, box * 0.22);
    ctx.fillStyle = "rgba(255,255,255,.94)";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(16,16,16,.12)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  const inner = card ? box * 0.72 : box;
  if (asset) {
    const ratio = Math.min(inner / asset.image.width, inner / asset.image.height);
    const width = asset.image.width * ratio;
    const height = asset.image.height * ratio;
    ctx.drawImage(asset.image, cx - width / 2, cy - height / 2, width, height);
    return;
  }

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = card ? "#101010" : "rgba(16,16,16,.78)";
  ctx.font = `700 ${box * 0.3}px Arial, sans-serif`;
  ctx.fillText(label, cx, cy - box * 0.04);
  ctx.font = `700 ${box * 0.055}px Arial, sans-serif`;
  ctx.letterSpacing = "4px";
  ctx.fillText("ЗАГРУЗИТЕ ЛОГО", cx, cy + box * 0.22);
  ctx.restore();
}

function drawCanvas(
  canvas: HTMLCanvasElement,
  mode: LayoutMode,
  firstColor: string,
  secondColor: string,
  logoOne: LogoAsset | null,
  logoTwo: LogoAsset | null,
  offsetOne: Point,
  offsetTwo: Point,
  scaleOne: number,
  scaleTwo: number,
  card: boolean,
  border: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.save();
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, 476, 0, Math.PI * 2);
  ctx.clip();

  const centers = getLogoCenters(mode, offsetOne, offsetTwo);

  if (mode === "flow") {
    ctx.fillStyle = secondColor;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(514, 0);
    ctx.bezierCurveTo(682, 205, 420, 336, 465, 519);
    ctx.bezierCurveTo(510, 708, 698, 768, 512, 1024);
    ctx.lineTo(0, 1024);
    ctx.closePath();
    ctx.fillStyle = firstColor;
    ctx.fill();
  }

  if (mode === "split") {
    ctx.fillStyle = firstColor;
    ctx.fillRect(0, 0, SIZE / 2, SIZE);
    ctx.fillStyle = secondColor;
    ctx.fillRect(SIZE / 2, 0, SIZE / 2, SIZE);
  }

  if (mode === "diagonal") {
    ctx.fillStyle = secondColor;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(760, 0);
    ctx.lineTo(265, SIZE);
    ctx.lineTo(0, SIZE);
    ctx.closePath();
    ctx.fillStyle = firstColor;
    ctx.fill();
  }

  if (mode === "wave") {
    ctx.fillStyle = secondColor;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(705, 0);
    ctx.bezierCurveTo(790, 145, 500, 245, 590, 405);
    ctx.bezierCurveTo(680, 570, 340, 655, 434, 805);
    ctx.bezierCurveTo(500, 905, 340, 970, 319, SIZE);
    ctx.lineTo(0, SIZE);
    ctx.closePath();
    ctx.fillStyle = firstColor;
    ctx.fill();
  }

  const boxOne = (scaleOne / 100) * 520;
  const boxTwo = (scaleTwo / 100) * 520;
  drawContained(ctx, logoOne, centers.one.x, centers.one.y, boxOne, "01", card);
  drawContained(ctx, logoTwo, centers.two.x, centers.two.y, boxTwo, "02", card);
  ctx.restore();

  if (border) {
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, 476, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,.88)";
    ctx.lineWidth = 14;
    ctx.stroke();
  }
}

function UploadCard({
  index,
  title,
  asset,
  processing,
  onFile,
}: {
  index: number;
  title: string;
  asset: LogoAsset | null;
  processing?: boolean;
  onFile: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const inputId = `logo-upload-${index}`;

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = "";
  };

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <label
      className={`upload-card ${dragging ? "is-dragging" : ""} ${processing ? "is-processing" : ""}`}
      htmlFor={inputId}
      onDragEnter={() => setDragging(true)}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
    >
      <input id={inputId} type="file" accept="image/png,image/jpeg,image/webp" onChange={change} />
      <span className="upload-number">0{index}</span>
      <span className="upload-preview" aria-hidden="true">
        {asset ? <img src={asset.url} alt="" /> : <span>+</span>}
      </span>
      <span className="upload-copy">
        <strong>{processing ? "Убираю фон…" : asset ? asset.name : title}</strong>
        <small>{processing ? "Это займёт пару секунд" : asset ? "Нажмите, чтобы заменить" : "PNG, JPG или WebP"}</small>
      </span>
      <span className="upload-action">{processing ? "Обработка" : asset ? "Заменить" : "Загрузить"}</span>
    </label>
  );
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    logo: LogoKey;
    pointerId: number;
    grabOffset: Point;
  } | null>(null);
  const [logoOne, setLogoOne] = useState<LogoAsset | null>(null);
  const [logoTwoOriginal, setLogoTwoOriginal] = useState<LogoAsset | null>(null);
  const [logoTwoClean, setLogoTwoClean] = useState<LogoAsset | null>(null);
  const [processing, setProcessing] = useState(false);
  const [autoRemove, setAutoRemove] = useState(true);
  const [mode, setMode] = useState<LayoutMode>("flow");
  const firstColor = "#CBF300";
  const [secondColor, setSecondColor] = useState("#FFFFFF");
  const [scaleOne, setScaleOne] = useState(52);
  const [scaleTwo, setScaleTwo] = useState(58);
  const [card, setCard] = useState(false);
  const [border, setBorder] = useState(true);
  const [offsetOne, setOffsetOne] = useState<Point>({ x: 0, y: 0 });
  const [offsetTwo, setOffsetTwo] = useState<Point>({ x: 0, y: 0 });
  const [draggingLogo, setDraggingLogo] = useState<LogoKey | null>(null);
  const [error, setError] = useState("");
  const logoTwo = autoRemove ? logoTwoClean ?? logoTwoOriginal : logoTwoOriginal;

  useEffect(() => {
    const image = new Image();
    image.onload = () => setLogoOne({ image, name: "Garna", url: "garna-mark.png" });
    image.src = "garna-mark.png";
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    drawCanvas(
      canvasRef.current,
      mode,
      firstColor,
      secondColor,
      logoOne,
      logoTwo,
      offsetOne,
      offsetTwo,
      scaleOne,
      scaleTwo,
      card,
      border,
    );
  }, [mode, firstColor, secondColor, logoOne, logoTwo, offsetOne, offsetTwo, scaleOne, scaleTwo, card, border]);

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * SIZE,
      y: ((event.clientY - bounds.top) / bounds.height) * SIZE,
    };
  };

  const startLogoDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event);
    const centers = getLogoCenters(mode, offsetOne, offsetTwo);
    const hitRadiusOne = Math.max(105, ((scaleOne / 100) * 520) / 2);
    const hitRadiusTwo = Math.max(105, ((scaleTwo / 100) * 520) / 2);
    const distanceOne = Math.hypot(point.x - centers.one.x, point.y - centers.one.y);
    const distanceTwo = Math.hypot(point.x - centers.two.x, point.y - centers.two.y);
    const hitsOne = distanceOne <= hitRadiusOne;
    const hitsTwo = distanceTwo <= hitRadiusTwo;

    if (!hitsOne && !hitsTwo) return;

    const logo: LogoKey = hitsOne && hitsTwo
      ? distanceOne / hitRadiusOne <= distanceTwo / hitRadiusTwo ? "one" : "two"
      : hitsOne ? "one" : "two";
    const center = centers[logo];

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      logo,
      pointerId: event.pointerId,
      grabOffset: { x: point.x - center.x, y: point.y - center.y },
    };
    setDraggingLogo(logo);
  };

  const moveLogo = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    const point = canvasPoint(event);
    let nextCenter = {
      x: point.x - drag.grabOffset.x,
      y: point.y - drag.grabOffset.y,
    };
    const centerDistance = Math.hypot(nextCenter.x - SIZE / 2, nextCenter.y - SIZE / 2);
    const draggedScale = drag.logo === "one" ? scaleOne : scaleTwo;
    const maxDistance = Math.max(40, 476 - ((draggedScale / 100) * 520) / 2);

    if (centerDistance > maxDistance) {
      const ratio = maxDistance / centerDistance;
      nextCenter = {
        x: SIZE / 2 + (nextCenter.x - SIZE / 2) * ratio,
        y: SIZE / 2 + (nextCenter.y - SIZE / 2) * ratio,
      };
    }

    const baseCenter = getLogoCenters(mode)[drag.logo];
    const nextOffset = {
      x: nextCenter.x - baseCenter.x,
      y: nextCenter.y - baseCenter.y,
    };

    if (drag.logo === "one") setOffsetOne(nextOffset);
    else setOffsetTwo(nextOffset);
  };

  const finishLogoDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDraggingLogo(null);
  };

  const selectMode = (nextMode: LayoutMode) => {
    setMode(nextMode);
    setOffsetOne({ x: 0, y: 0 });
    setOffsetTwo({ x: 0, y: 0 });
  };

  const loadLogo = (file: File) => {
    setError("");
    setOffsetTwo({ x: 0, y: 0 });
    if (!file.type.startsWith("image/")) {
      setError("Нужен файл изображения: PNG, JPG или WebP.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Файл слишком большой. Максимальный размер — 12 МБ.");
      return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    setProcessing(true);
    image.onload = async () => {
      const original = { image, name: file.name, url };
      try {
        const clean = await removeFlatBackground(image, file.name);
        if (logoTwoOriginal) URL.revokeObjectURL(logoTwoOriginal.url);
        if (logoTwoClean) URL.revokeObjectURL(logoTwoClean.url);
        setLogoTwoOriginal(original);
        setLogoTwoClean(clean);
      } catch {
        if (logoTwoOriginal) URL.revokeObjectURL(logoTwoOriginal.url);
        if (logoTwoClean) URL.revokeObjectURL(logoTwoClean.url);
        setLogoTwoOriginal(original);
        setLogoTwoClean(null);
        setError("Логотип загружен, но фон не удалось убрать автоматически.");
      } finally {
        setProcessing(false);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setProcessing(false);
      setError("Не получилось прочитать изображение. Попробуйте другой файл.");
    };
    image.src = url;
  };

  const reset = () => {
    if (logoTwoOriginal) URL.revokeObjectURL(logoTwoOriginal.url);
    if (logoTwoClean) URL.revokeObjectURL(logoTwoClean.url);
    setLogoTwoOriginal(null);
    setLogoTwoClean(null);
    setMode("flow");
    setSecondColor("#FFFFFF");
    setScaleOne(52);
    setScaleTwo(58);
    setCard(false);
    setBorder(true);
    setAutoRemove(true);
    setOffsetOne({ x: 0, y: 0 });
    setOffsetTwo({ x: 0, y: 0 });
    setError("");
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "combined-logo-telegram-1024.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <main className="tool-page">
      <header className="site-header">
        <div className="brand" aria-label="Garna Client Avatar Maker">
          <span className="brand-mark"><img src="garna-logo.png" alt="" /></span>
          <span>garna / client avatar maker</span>
        </div>
        <span className="privacy-pill"><i /> Ваши файлы никуда не загружаются</span>
      </header>

      <section className="studio tool-only" aria-label="Редактор логотипов">
        <div className="controls">
          <div className="panel-heading">
            <div><span className="step-kicker">Шаг 01</span><h2>Добавьте логотип клиента</h2></div>
          </div>

          <div className="uploads">
            <div className="upload-card fixed-logo-card" aria-label="Логотип Garna установлен по умолчанию">
              <span className="upload-number">01</span>
              <span className="upload-preview"><img src="garna-logo.png" alt="" /></span>
              <span className="upload-copy"><strong>Garna</strong><small>Фирменный логотип</small></span>
              <span className="upload-action locked-action">Зафиксирован</span>
            </div>
            <UploadCard index={2} title="Логотип клиента" asset={logoTwo} processing={processing} onFile={loadLogo} />
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}

          <div className="divider" />

          <div className="section-title"><span className="step-kicker">Шаг 02</span><h2>Выберите композицию</h2></div>
          <div className="layout-grid">
            {layouts.map((layout) => (
              <button
                key={layout.id}
                className={`layout-choice ${mode === layout.id ? "is-active" : ""}`}
                onClick={() => selectMode(layout.id)}
                type="button"
                aria-pressed={mode === layout.id}
              >
                <span className={`layout-icon ${layout.id}`}><i /><b /></span>
                <span><strong>{layout.title}</strong></span>
              </button>
            ))}
          </div>

          <div className="divider" />

          <div className="section-title"><span className="step-kicker">Шаг 03</span><h2>Настройте стиль</h2></div>
          <div className="color-row">
            <label className="locked-color"><span>Цвет Garna</span><i /><code>#CBF300</code></label>
            <label><span>Цвет клиента</span><input type="color" value={secondColor} onChange={(event) => setSecondColor(event.target.value)} /><code>{secondColor.toUpperCase()}</code></label>
          </div>

          <div className="range-grid">
            <label className="range-control">
              <span><b>Логотип Garna</b><output>{scaleOne}%</output></span>
              <input aria-label="Размер логотипа Garna" type="range" min="35" max="75" value={scaleOne} onChange={(event) => setScaleOne(Number(event.target.value))} />
            </label>
            <label className="range-control">
              <span><b>Логотип клиента</b><output>{scaleTwo}%</output></span>
              <input aria-label="Размер логотипа клиента" type="range" min="35" max="75" value={scaleTwo} onChange={(event) => setScaleTwo(Number(event.target.value))} />
            </label>
          </div>

          <div className="toggle-row">
            <label><span><b>Удалять фон</b><small>Автоматически по краям</small></span><input type="checkbox" checked={autoRemove} onChange={(event) => setAutoRemove(event.target.checked)} /><i /></label>
            <label><span><b>Подложки</b><small>Белые карточки под логотипами</small></span><input type="checkbox" checked={card} onChange={(event) => setCard(event.target.checked)} /><i /></label>
            <label><span><b>Светлая рамка</b><small>Безопасный край для Telegram</small></span><input type="checkbox" checked={border} onChange={(event) => setBorder(event.target.checked)} /><i /></label>
          </div>
        </div>

        <aside className="preview-panel">
          <div className="preview-topline"><span><i /> Live preview</span><b>1024 × 1024 px</b></div>
          <div className="preview-stage">
            <div className="glow glow-one" /><div className="glow glow-two" />
            <canvas
              ref={canvasRef}
              className={draggingLogo ? "is-dragging" : ""}
              width={SIZE}
              height={SIZE}
              aria-label="Предпросмотр объединённого логотипа. Логотипы можно перетаскивать."
              onPointerDown={startLogoDrag}
              onPointerMove={moveLogo}
              onPointerUp={finishLogoDrag}
              onPointerCancel={finishLogoDrag}
            />
            <span className="crop-note">Круглый кроп Telegram</span>
          </div>
          <div className="action-row">
            <button className="download-button" type="button" onClick={download}>
              <span>Скачать PNG</span><i>↘</i>
            </button>
            <button className="reset-button" type="button" onClick={reset}>Сбросить</button>
          </div>
          <p className="preview-note"><span>●</span> Экспорт с прозрачными углами и готовым круглым кропом.</p>
        </aside>
      </section>

    </main>
  );
}

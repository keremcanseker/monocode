import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Folder,
  Minus,
  Plus,
  RotateCcw,
} from "../../../shared/ui/icons";
import { ExplorerMenu } from "./ExplorerMenu";
import { FileTypeIcon } from "./FileTypeIcon";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  formatFileSize,
  isPdfBytes,
  sniffImageMime,
} from "../model/filePreview";
import { watchFile } from "../model/fileWatch";
import {
  basename,
  copyFileToClipboard,
  readBinaryFile,
  revealPath,
} from "../../../platform/tauri/fs";
import { displayPath } from "../../../shared/lib/paths";
import { IS_MAC } from "../../../platform/tauri/platform";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 16;
// A page past this blows WebKit's canvas size limit and draws blank.
const MAX_PDF_ZOOM = 4;
// Pixels per page canvas, as pdf.js's own viewer caps them, so Retina at a
// high zoom does not hold hundreds of MB across the pages kept drawn.
const MAX_PDF_CANVAS_PIXELS = 16 * 1024 * 1024;

type Props = { path: string; cwd: string };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; url: string; mime: string; size: number }
  | { status: "pdf"; bytes: Uint8Array }
  | { status: "unsupported"; size: number }
  | { status: "error"; message: string };

/**
 * Read-only surface for files the editor can't open. Images and PDFs render;
 * other bytes get a card pointing at the file on disk.
 */
export function BinaryFileView({ path, cwd }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setState({ status: "loading" });

    readBinaryFile(path).then(
      (bytes) => {
        if (cancelled) return;
        // The blob's MIME comes from the bytes, never the extension, so a file
        // named `.png` that holds markup can't become a same-origin document.
        const mime = sniffImageMime(bytes);
        if (!mime && isPdfBytes(bytes)) {
          setState({ status: "pdf", bytes });
          return;
        }
        if (!mime) {
          setState({ status: "unsupported", size: bytes.byteLength });
          return;
        }
        created = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({
          status: "ready",
          url: created,
          mime,
          size: bytes.byteLength,
        });
      },
      (cause: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      },
    );

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, reloadKey]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let timer = 0;
    const stop = watchFile(path, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reload, 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [path, reload]);

  if (state.status === "loading") {
    return (
      <div className="grid h-full place-items-center text-[12px] text-content/45">
        Opening {basename(path)}…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <FileCard
        path={path}
        cwd={cwd}
        title={`Couldn’t open ${basename(path)}`}
        detail={state.message}
        icon={<AlertCircle className="mx-auto mb-3 size-5 text-red-400" />}
        onRetry={reload}
      />
    );
  }

  if (state.status === "unsupported") {
    return (
      <FileCard
        path={path}
        cwd={cwd}
        title={basename(path)}
        detail={`${formatFileSize(state.size)} · no preview for this file`}
        icon={
          <div className="mx-auto mb-3 flex justify-center">
            <FileTypeIcon name={basename(path)} isDir={false} size={28} />
          </div>
        }
      />
    );
  }

  if (state.status === "pdf") {
    return <PdfView key={reloadKey} bytes={state.bytes} />;
  }

  return (
    <ImageView
      path={path}
      url={state.url}
      size={state.size}
      mime={state.mime}
    />
  );
}

function ImageView({
  path,
  url,
  size,
  mime,
}: {
  path: string;
  url: string;
  size: number;
  mime: string;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copyOriginal = useCallback(() => {
    setMenu(null);
    void copyFileToClipboard(path).then(
      () => {
        setCopied(true);
        if (copiedTimer.current != null) {
          window.clearTimeout(copiedTimer.current);
        }
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      (error: unknown) => {
        console.error("Failed to copy image file:", error);
      },
    );
  }, [path]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="grid min-h-0 flex-1 place-items-center overflow-auto overscroll-contain p-4"
        style={{
          // A checkerboard so transparent PNGs read as transparent rather than
          // as whatever the theme background happens to be.
          backgroundImage:
            "linear-gradient(45deg, rgba(128,128,128,0.10) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.10) 75%), linear-gradient(45deg, rgba(128,128,128,0.10) 25%, transparent 25%, transparent 75%, rgba(128,128,128,0.10) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 8px 8px",
        }}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(event) =>
            setNatural({
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            })
          }
          onClick={() => setZoom((value) => (value === "fit" ? 1 : "fit"))}
          onContextMenu={
            IS_MAC
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({ x: event.clientX, y: event.clientY });
                }
              : undefined
          }
          className={
            zoom === "fit"
              ? "max-h-full max-w-full object-contain"
              : "max-w-none object-contain"
          }
          style={
            zoom === "fit" || !natural
              ? undefined
              : { width: natural.w * zoom, height: natural.h * zoom }
          }
        />
      </div>
      <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-stroke px-3 text-[11px] text-content/50">
        <span className="tabular-nums">
          {natural ? `${natural.w} × ${natural.h}` : "—"}
        </span>
        <span className="tabular-nums">{formatFileSize(size)}</span>
        <span className="uppercase">{mime.replace(/^image\//, "")}</span>
        <span className="flex-1" />
        {IS_MAC ? (
          <ZoomButton
            label={copied ? "Copied" : "Copy original file"}
            onClick={copyOriginal}
          >
            {copied ? (
              <Check className="size-3" strokeWidth={2} />
            ) : (
              <Copy className="size-3" strokeWidth={1.75} />
            )}
          </ZoomButton>
        ) : null}
        <ZoomButton
          label="Zoom out"
          onClick={() =>
            setZoom((value) => clampZoom((value === "fit" ? 1 : value) / 1.5))
          }
        >
          <Minus className="size-3" strokeWidth={1.75} />
        </ZoomButton>
        <button
          type="button"
          title="Fit to window"
          onClick={() => setZoom("fit")}
          className="w-11 rounded text-center tabular-nums hover:text-content"
        >
          {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <ZoomButton
          label="Zoom in"
          onClick={() =>
            setZoom((value) => clampZoom((value === "fit" ? 1 : value) * 1.5))
          }
        >
          <Plus className="size-3" strokeWidth={1.75} />
        </ZoomButton>
      </footer>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              kind: "item",
              id: "copy-original",
              label: "Copy Original File",
            },
          ]}
          ariaLabel="Image actions"
          onPick={(id) => {
            if (id === "copy-original") copyOriginal();
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

type PdfPage = { width: number; height: number };

/**
 * Pages drawn by pdf.js, loaded only when a PDF opens. Each page keeps its
 * place at its real size and is drawn only while near the viewport, so a
 * long document costs a few canvases, not one per page.
 */
function PdfView({ bytes }: { bytes: Uint8Array }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    void (async () => {
      // The legacy build carries polyfills older WebKit lacks.
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const { default: workerSrc } =
        await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
      if (cancelled) return;
      // Given a URL, pdf.js wraps it in a blob: worker, since tauri:// reads
      // as an opaque origin, and the CSP refuses blob: scripts. A port it is
      // handed is used as is, and kept alive across documents.
      pdfjs.GlobalWorkerOptions.workerPort ??= new Worker(workerSrc, {
        type: "module",
      });
      // pdf.js takes ownership of the buffer it is given.
      const loading = pdfjs.getDocument({
        data: bytes.slice(),
        // The worker fetches these itself. pdf.js would fetch tauri:// URLs
        // on the page instead, where the CSP's connect-src refuses them; in
        // the desktop app the worker runs without a CSP. Web mode's server
        // sends one with no wasm-unsafe-eval, so there the decoders fall back
        // to their slower JS builds. Should a fetch fail, pdf.js uses
        // substitute fonts and leaves out the images it can't decode.
        ...pdfjsResourceUrls(),
        useWorkerFetch: true,
      });
      task = loading;
      const loaded = await loading.promise;
      const sizes: PdfPage[] = [];
      for (let number = 1; number <= loaded.numPages; number += 1) {
        const page = await loaded.getPage(number);
        if (cancelled) return;
        const { width, height } = page.getViewport({ scale: 1 });
        sizes.push({ width, height });
        if (number === 1) {
          // Show the first page now; the rest take its size until measured.
          setDoc(loaded);
          setPages(Array.from({ length: loaded.numPages }, () => sizes[0]));
        }
      }
      if (cancelled) return;
      setPages(sizes);
    })().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    // Settled, so dragging a pane edge does not redraw every page per frame.
    let timer = 0;
    setWidth(scroller.clientWidth);
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setWidth(scroller.clientWidth), 120);
    });
    observer.observe(scroller);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  const widest = pages.reduce((max, page) => Math.max(max, page.width), 0);
  const scale =
    zoom === "fit"
      ? clampPdfZoom(widest && width > 48 ? (width - 48) / widest : 1)
      : zoom;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-content/5"
      >
        {error ? (
          <p className="p-6 text-center text-[12px] text-content/50">
            Couldn’t render this PDF: {error}
          </p>
        ) : !doc ? (
          <p className="p-6 text-center text-[12px] text-content/45">
            Rendering…
          </p>
        ) : (
          <div className="flex w-max min-w-full flex-col items-center gap-4 p-6">
            {pages.map((page, index) => (
              <PdfPageCanvas
                key={index}
                doc={doc}
                number={index + 1}
                width={page.width * scale}
                height={page.height * scale}
                scale={scale}
                root={scrollRef.current}
              />
            ))}
          </div>
        )}
      </div>
      <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-stroke px-3 text-[11px] text-content/50">
        <span className="tabular-nums">
          {pages.length
            ? `${pages.length} page${pages.length === 1 ? "" : "s"}`
            : "—"}
        </span>
        <span className="tabular-nums">{formatFileSize(bytes.byteLength)}</span>
        <span>PDF</span>
        <span className="flex-1" />
        <ZoomButton
          label="Zoom out"
          onClick={() => setZoom(clampPdfZoom(scale / 1.25))}
        >
          <Minus className="size-3" strokeWidth={1.75} />
        </ZoomButton>
        <button
          type="button"
          title="Fit to width"
          onClick={() => setZoom("fit")}
          className="w-11 rounded text-center tabular-nums hover:text-content"
        >
          {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <ZoomButton
          label="Zoom in"
          onClick={() => setZoom(clampPdfZoom(scale * 1.25))}
        >
          <Plus className="size-3" strokeWidth={1.75} />
        </ZoomButton>
      </footer>
    </div>
  );
}

function pdfjsResourceUrls() {
  const base = new URL(
    import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : "/pdfjs/",
    window.location.href,
  ).href;
  return {
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
  };
}

function clampPdfZoom(value: number): number {
  return Math.min(MAX_PDF_ZOOM, clampZoom(value));
}

function PdfPageCanvas({
  doc,
  number,
  width,
  height,
  scale,
  root,
}: {
  doc: PDFDocumentProxy;
  number: number;
  width: number;
  height: number;
  scale: number;
  root: HTMLElement | null;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root, rootMargin: "100% 0px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!near) {
      // Hand the bitmap back while the page is far from view.
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    let cancelled = false;
    let render: { cancel(): void } | null = null;
    void doc
      .getPage(number)
      .then((page) => {
        if (cancelled) return;
        const base = page.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          Math.sqrt(MAX_PDF_CANVAS_PIXELS / (base.width * base.height)),
        );
        const viewport = page.getViewport({ scale: scale * ratio });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const task = page.render({ canvas, viewport });
        render = task;
        // A newer zoom cancels this one; that rejection is expected.
        task.promise.catch(() => undefined);
      })
      // The document closes when the view does.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, near, number, scale]);

  return (
    <div
      ref={boxRef}
      className="shrink-0 bg-white shadow-sm"
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-5 place-items-center rounded hover:bg-content/10 hover:text-content"
    >
      {children}
    </button>
  );
}

function FileCard({
  path,
  cwd,
  title,
  detail,
  icon,
  onRetry,
}: {
  path: string;
  cwd: string;
  title: string;
  detail: string;
  icon: React.ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md text-center">
        {icon}
        <p className="text-[13px] text-content">{title}</p>
        <p className="mt-1 text-[12px] leading-5 text-content/50">{detail}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-content/35">
          {displayPath(path, cwd)}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {onRetry ? (
            <CardButton onClick={onRetry}>
              <RotateCcw className="size-3" strokeWidth={1.75} />
              Retry
            </CardButton>
          ) : null}
          <CardButton onClick={() => void revealPath(path).catch(() => {})}>
            <Folder className="size-3" strokeWidth={1.75} />
            Reveal
          </CardButton>
          <CardButton onClick={() => void copyText(path).catch(() => {})}>
            Copy path
          </CardButton>
        </div>
      </div>
    </div>
  );
}

function CardButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 items-center gap-1.5 rounded-md bg-content/10 px-2.5 text-[12px] text-content hover:bg-content/15"
    >
      {children}
    </button>
  );
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

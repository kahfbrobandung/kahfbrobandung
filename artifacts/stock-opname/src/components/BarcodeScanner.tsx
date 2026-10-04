import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Camera, Loader2, Zap, ZapOff, ImageIcon, CheckCircle2, AlertCircle } from 'lucide-react';

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (text: string) => void;
}

// ─── Platform helpers ────────────────────────────────────────────────────────

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

// Native BarcodeDetector API — Chrome Android uses MLKit (fast), Safari 17+ supported.
// Much better for EAN-13 than any JS library.
const hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;

const NATIVE_FORMATS = [
  'ean_13', 'ean_8', 'upc_a', 'upc_e',
  'code_128', 'code_39', 'itf',
];

// Camera constraints — iOS skips `exact` to avoid OverconstrainedError
function getCameraConstraints() {
  if (isIOS()) {
    return [
      { video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } },
      { video: { facingMode: 'environment' } },
      { video: true },
    ];
  }
  return [
    { video: { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { video: { facingMode: 'environment' } },
    { video: true },
  ];
}

// ─── ZXing fallback (lazy import so it doesn't slow down native path) ────────

async function startZxingScanner(
  videoEl: HTMLVideoElement,
  stream: MediaStream,
  onResult: (text: string) => void,
  isMounted: () => boolean,
): Promise<() => void> {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const { DecodeHintType, BarcodeFormat } = await import('@zxing/library');

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
  ]);

  const reader = new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 200,
    delayBetweenScanSuccess: 600,
  });

  let controls: any = null;

  // ZXing needs to own the stream — attach it
  const ctrl = await reader.decodeFromStream(stream, videoEl, (result, _err, ctrls) => {
    if (result && isMounted()) {
      ctrls.stop();
      onResult(result.getText());
    }
  });
  controls = ctrl;

  return () => {
    try { controls?.stop(); } catch (_) { /* ignore */ }
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BarcodeScanner({ isOpen, onClose, onScanSuccess }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingStopRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(false);
  const onScanSuccessRef = useRef(onScanSuccess);
  const onCloseRef = useRef(onClose);
  const [status, setStatus] = useState<'loading' | 'active' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [mode, setMode] = useState<'native' | 'zxing' | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [galleryStatus, setGalleryStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [galleryMsg, setGalleryMsg] = useState('');

  useEffect(() => { onScanSuccessRef.current = onScanSuccess; }, [onScanSuccess]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const stopEverything = useCallback(() => {
    isMountedRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (zxingStopRef.current) {
      zxingStopRef.current();
      zxingStopRef.current = null;
    }
    if (streamRef.current) {
      // Turn off torch before stopping — some devices keep it on otherwise
      try {
        const track = streamRef.current.getVideoTracks()[0];
        if (track) track.applyConstraints({ advanced: [{ torch: false } as any] }).catch(() => {});
      } catch (_) {}
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorchOn(next);
    } catch (_) {
      // Silently ignore — button won't appear if torch isn't supported anyway
    }
  }, [torchOn]);

  // Acquire camera stream with constraint fallback
  async function acquireStream(): Promise<MediaStream | null> {
    const constraints = getCameraConstraints();
    for (const c of constraints) {
      try {
        return await navigator.mediaDevices.getUserMedia(c);
      } catch (err: any) {
        const msg = (err?.message || err?.name || '').toLowerCase();
        if (msg.includes('notallowed') || msg.includes('permission') || msg.includes('denied')) {
          throw err; // Permission error — no point retrying
        }
        // Overconstrained / not found — try next
      }
    }
    return null;
  }

  // ── Gallery image processing ──────────────────────────────────────────────
  const processImageFile = useCallback(async (file: File) => {
    setGalleryStatus('processing');
    setGalleryMsg('');
    try {
      if (hasBarcodeDetector) {
        // Native path — fastest, uses GPU/MLKit
        let formats = NATIVE_FORMATS;
        try {
          const supported: string[] = await (window as any).BarcodeDetector.getSupportedFormats();
          formats = NATIVE_FORMATS.filter(f => supported.includes(f));
        } catch (_) {}
        const detector = new (window as any).BarcodeDetector({ formats });
        const bitmap = await createImageBitmap(file);
        const results: any[] = await detector.detect(bitmap);
        bitmap.close();
        if (results.length > 0) {
          setGalleryStatus('success');
          setTimeout(() => {
            onScanSuccessRef.current(results[0].rawValue);
            onCloseRef.current();
          }, 400);
        } else {
          setGalleryStatus('error');
          setGalleryMsg('Barcode tidak ditemukan. Coba foto yang lebih terang dan jelas.');
        }
      } else {
        // ZXing fallback
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const { DecodeHintType, BarcodeFormat } = await import('@zxing/library');
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true); // helpful for static images
        const reader = new BrowserMultiFormatReader(hints);
        const url = URL.createObjectURL(file);
        try {
          const result = await reader.decodeFromImageUrl(url);
          setGalleryStatus('success');
          setTimeout(() => {
            onScanSuccessRef.current(result.getText());
            onCloseRef.current();
          }, 400);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch (_) {
      setGalleryStatus('error');
      setGalleryMsg('Barcode tidak ditemukan. Coba foto yang lebih terang dan jelas.');
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopEverything();
      setStatus('loading');
      setErrorMsg('');
      setMode(null);
      setGalleryStatus('idle');
      setGalleryMsg('');
      return;
    }

    isMountedRef.current = true;
    setStatus('loading');
    setErrorMsg('');

    async function start() {
      await new Promise(r => setTimeout(r, 80));
      if (!isMountedRef.current || !videoRef.current) return;

      // ── Acquire camera stream ──────────────────────────────────────────────
      let stream: MediaStream | null = null;
      try {
        stream = await acquireStream();
      } catch (err: any) {
        if (!isMountedRef.current) return;
        const msg = (err?.message || err?.name || '').toLowerCase();
        setStatus('error');
        setErrorMsg(
          msg.includes('notallowed') || msg.includes('permission') || msg.includes('denied')
            ? isIOS()
              ? 'Akses kamera ditolak. Buka Pengaturan → Safari → Kamera dan izinkan akses.'
              : 'Akses kamera ditolak. Izinkan akses kamera di pengaturan browser.'
            : 'Kamera tidak tersedia.'
        );
        return;
      }

      if (!stream || !isMountedRef.current) {
        stream?.getTracks().forEach(t => t.stop());
        if (isMountedRef.current) {
          setStatus('error');
          setErrorMsg('Kamera tidak ditemukan. Pastikan perangkat memiliki kamera aktif.');
        }
        return;
      }

      streamRef.current = stream;

      // Check capabilities and apply optimal focus settings
      try {
        const track = stream.getVideoTracks()[0];
        if (track) {
          const caps = track.getCapabilities() as any;
          if (caps?.torch) setTorchSupported(true);

          // Request continuous autofocus — helps iPhone re-focus as distance changes.
          // Silently ignored if not supported.
          const focusConstraint: any = {};
          if (caps?.focusMode?.includes?.('continuous')) {
            focusConstraint.focusMode = 'continuous';
          }
          if (Object.keys(focusConstraint).length > 0) {
            await track.applyConstraints({ advanced: [focusConstraint] }).catch(() => {});
          }
        }
      } catch (_) { /* getCapabilities not supported on this browser */ }

      // Attach stream to video element
      videoRef.current.srcObject = stream;
      try {
        await videoRef.current.play();
      } catch (_) { /* autoPlay policy — usually fine on mobile */ }

      if (!isMountedRef.current) { stopEverything(); return; }

      // ── Native BarcodeDetector (Chrome Android MLKit, Safari 17+) ─────────
      if (hasBarcodeDetector) {
        setMode('native');
        setStatus('active');

        let formats = NATIVE_FORMATS;
        try {
          const supported: string[] = await (window as any).BarcodeDetector.getSupportedFormats();
          formats = NATIVE_FORMATS.filter(f => supported.includes(f));
        } catch (_) { /* use default list */ }

        const detector = new (window as any).BarcodeDetector({ formats });

        const scanFrame = async () => {
          if (!isMountedRef.current) return;
          try {
            const video = videoRef.current;
            if (video && video.readyState >= 2 && video.videoWidth > 0) {
              const results: any[] = await detector.detect(video);
              if (results.length > 0 && isMountedRef.current) {
                const val = results[0].rawValue;
                stopEverything();
                onScanSuccessRef.current(val);
                onCloseRef.current();
                return;
              }
            }
          } catch (_) { /* frame not ready yet */ }
          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
        return;
      }

      // ── ZXing fallback ────────────────────────────────────────────────────
      setMode('zxing');
      try {
        const stop = await startZxingScanner(
          videoRef.current!,
          stream,
          (text) => {
            if (isMountedRef.current) {
              stopEverything();
              onScanSuccessRef.current(text);
              onCloseRef.current();
            }
          },
          () => isMountedRef.current,
        );
        if (isMountedRef.current) {
          zxingStopRef.current = stop;
          setStatus('active');
        } else {
          stop();
          stopEverything();
        }
      } catch (err: any) {
        if (isMountedRef.current) {
          setStatus('error');
          setErrorMsg('Gagal memulai scanner. Coba muat ulang halaman.');
        }
      }
    }

    start();

    return () => { stopEverything(); };
  }, [isOpen, stopEverything]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#000' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 text-white"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 16px)',
          paddingBottom: 12,
          background: 'rgba(0,0,0,0.85)',
        }}
      >
        <div className="flex items-center gap-2">
          <Camera size={20} />
          <span className="font-semibold tracking-wide text-sm">Scan Barcode</span>
          {status === 'active' && (
            <span className="ml-1 w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
          )}
        </div>
        {status === 'active' && mode && (
          <span className="text-white/40 text-xs mr-auto ml-2">
            {mode === 'native' ? '⚡ Native' : 'ZXing'}
          </span>
        )}

        <div className="flex items-center gap-1">
          {/* Torch / flashlight button — only shown when hardware supports it */}
          {status === 'active' && torchSupported && (
            <button
              onClick={toggleTorch}
              className="p-2 rounded-full active:scale-95 transition-all"
              style={{
                background: torchOn ? '#c9a96e' : 'rgba(255,255,255,0.12)',
                color: torchOn ? '#1a2e1a' : '#fff',
              }}
              aria-label={torchOn ? 'Matikan senter' : 'Nyalakan senter'}
              title={torchOn ? 'Matikan senter' : 'Nyalakan senter'}
            >
              {torchOn ? <Zap size={20} fill="currentColor" /> : <ZapOff size={20} />}
            </button>
          )}

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/20 active:scale-95 transition-transform"
            aria-label="Tutup kamera"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Camera area */}
      <div className="relative flex-1" style={{ background: '#000' }}>
        {status === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl px-6 py-6 max-w-sm">
              <Camera size={32} className="mx-auto mb-3 opacity-60" />
              <p className="font-semibold text-sm mb-1">Kamera Tidak Bisa Dibuka</p>
              <p className="text-xs opacity-80 mb-4">{errorMsg}</p>
              <button
                onClick={onClose}
                className="px-5 py-2 bg-white/10 text-white rounded-xl text-sm font-medium hover:bg-white/20 transition-colors"
              >
                Tutup
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Video — always rendered so ref is available */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />

            {/* Loading overlay */}
            {status === 'loading' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
                <Loader2 size={36} className="text-white animate-spin mb-3" />
                <p className="text-white/80 text-sm">Membuka kamera...</p>
              </div>
            )}

            {/* Active scanning overlay */}
            {status === 'active' && (
              <>
                {/* Dark mask outside scan box */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: 'radial-gradient(ellipse 300px 120px at 50% 46%, transparent 100%, rgba(0,0,0,0.55) 100%)',
                }} />

                {/* Scan target — wide & short for EAN-13 */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -54%)',
                    width: 'min(300px, 86vw)',
                    height: 110,
                    borderRadius: 10,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.52)',
                    border: '2px solid rgba(255,255,255,0.65)',
                    overflow: 'hidden',
                  }}
                >
                  {/* Corner markers */}
                  {(['tl','tr','bl','br'] as const).map(pos => (
                    <div key={pos} style={{
                      position: 'absolute',
                      width: 22, height: 22,
                      top: pos.startsWith('t') ? 0 : undefined,
                      bottom: pos.startsWith('b') ? 0 : undefined,
                      left: pos.endsWith('l') ? 0 : undefined,
                      right: pos.endsWith('r') ? 0 : undefined,
                      borderTop: pos.startsWith('t') ? '3px solid #fff' : undefined,
                      borderBottom: pos.startsWith('b') ? '3px solid #fff' : undefined,
                      borderLeft: pos.endsWith('l') ? '3px solid #fff' : undefined,
                      borderRight: pos.endsWith('r') ? '3px solid #fff' : undefined,
                      borderRadius:
                        pos === 'tl' ? '8px 0 0 0' :
                        pos === 'tr' ? '0 8px 0 0' :
                        pos === 'bl' ? '0 0 0 8px' : '0 0 8px 0',
                    }} />
                  ))}
                  {/* Scan line */}
                  <div style={{
                    animation: 'scanLine 1.8s ease-in-out infinite',
                    position: 'absolute',
                    left: 0, right: 0,
                    height: 2,
                    background: 'linear-gradient(90deg, transparent, #c9a96e, transparent)',
                    boxShadow: '0 0 8px 2px #c9a96e88',
                  }} />
                </div>

                {/* Guide text */}
                <div
                  className="absolute flex flex-col items-center gap-2 px-6"
                  style={{ bottom: '18%', left: 0, right: 0 }}
                >
                  <p
                    className="text-center text-white/80 text-sm font-medium"
                    style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
                  >
                    Posisikan barcode <em>horizontal</em> di dalam kotak
                  </p>
                  {/* iPhone focus-distance tip — iPhone 13 min focus ~15 cm */}
                  {isIOS() && (
                    <p
                      className="text-center text-yellow-300/80 text-xs px-4 py-1.5 rounded-full"
                      style={{
                        background: 'rgba(0,0,0,0.45)',
                        textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                      }}
                    >
                      📏 iPhone: jauhkan HP ±15–20 cm agar kamera bisa fokus
                    </p>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Gallery footer — always visible as alternative to camera */}
      <div
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 20px)',
          paddingTop: 16,
          paddingLeft: 24,
          paddingRight: 24,
          background: 'rgba(0,0,0,0.90)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* Status feedback for gallery scan */}
        {galleryStatus === 'processing' && (
          <div className="flex items-center gap-2 text-white/80 text-sm">
            <Loader2 size={16} className="animate-spin" />
            <span>Memindai foto...</span>
          </div>
        )}
        {galleryStatus === 'success' && (
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <CheckCircle2 size={16} />
            <span>Barcode berhasil dibaca!</span>
          </div>
        )}
        {galleryStatus === 'error' && (
          <div className="flex items-center gap-2 text-red-400 text-sm text-center">
            <AlertCircle size={15} className="shrink-0" />
            <span>{galleryMsg}</span>
          </div>
        )}

        {/* Gallery button */}
        <button
          onClick={() => {
            setGalleryStatus('idle');
            fileInputRef.current?.click();
          }}
          disabled={galleryStatus === 'processing'}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95"
          style={{
            background: galleryStatus === 'processing' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.13)',
            color: galleryStatus === 'processing' ? 'rgba(255,255,255,0.4)' : '#fff',
            border: '1px solid rgba(255,255,255,0.18)',
            width: '100%',
            justifyContent: 'center',
          }}
        >
          <ImageIcon size={17} />
          Pilih dari Galeri
        </button>

        {/* Hidden file input — accepts images only */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) processImageFile(file);
            // Reset so same file can be picked again
            e.target.value = '';
          }}
        />
      </div>

      <style>{`
        @keyframes scanLine {
          0%   { top: 8%; opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { top: 88%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}

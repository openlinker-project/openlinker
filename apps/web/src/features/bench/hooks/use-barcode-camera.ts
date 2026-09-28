/**
 * Reading a barcode with the device camera (mobile-first rebuild, epic #3401)
 *
 * A packer walking the floor has no wedge scanner. The phone's own camera is
 * the reader, and this hook is the whole of it: permission, stream, decode
 * loop, torch, teardown.
 *
 * ## It reports what it CANNOT do, rather than looking broken
 *
 * `support` is resolved before anything is asked of the device, and every
 * caller is expected to render the reason rather than a control that fails
 * when pressed:
 *
 * - `ready` — `BarcodeDetector` and a camera are both present.
 * - `no-detector` — the browser has no barcode decoder. This is SAFARI and
 *   Firefox today, which is most iPhones: the API is Chromium-only. Typing a
 *   code is the path there, and the surface says so rather than offering a
 *   camera that cannot decode.
 * - `no-camera` — no `getUserMedia`, which also covers an insecure origin: a
 *   bench served over plain HTTP gets no camera at all, and that is a
 *   deployment fact an operator can act on.
 *
 * A WASM decoder would close the Safari gap and is deliberately NOT bundled
 * here: it is a new runtime dependency of a few hundred kilobytes on every
 * bench load, including the desktop benches that will never open a camera,
 * and that is a decision to take deliberately rather than inside this hook.
 *
 * ## The same code is not counted twice by accident
 *
 * A camera reads the same barcode thirty times a second while it points at
 * it. `REPEAT_SUPPRESSION_MS` is what stops one unit becoming thirty: a value
 * identical to the last one is ignored until the packer has had time to move
 * the phone. It is a UI guard and NOT the correctness guarantee — that stays
 * the server's own over-pack refusal (E3), which is what makes a genuine
 * second unit of the same code still countable.
 *
 * ## Formats
 *
 * `ean_13` / `ean_8` / `upc_a` / `upc_e` are product barcodes, `code_128` and
 * `code_39` are what carriers print on labels, `qr_code` because some
 * marketplaces use one. Nothing else is asked for: every extra format is more
 * work per frame and more ways to read the wrong thing off a crowded label.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const BARCODE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'qr_code',
] as const;

/** A camera reads one label many times a second; see the module docblock. */
export const REPEAT_SUPPRESSION_MS = 2_500;
/** Decode cadence. Faster buys nothing a hand can use and costs battery. */
const DECODE_INTERVAL_MS = 220;

export type BarcodeCameraSupport = 'ready' | 'no-detector' | 'no-camera';

export type BarcodeCameraError = 'permission-denied' | 'no-device' | 'failed';

interface DetectedBarcode {
  readonly rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<readonly DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
}

function detectorConstructor(): BarcodeDetectorConstructor | null {
  const candidate = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  return typeof candidate === 'function' ? candidate : null;
}

export function resolveBarcodeCameraSupport(): BarcodeCameraSupport {
  if (detectorConstructor() === null) return 'no-detector';
  // Absent on an insecure origin as well as on a device with no camera — both
  // mean the same thing to a packer: this button cannot work here.
  if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
    return 'no-camera';
  }
  return 'ready';
}

export interface UseBarcodeCameraOptions {
  /** Called once per accepted read. Repeats are suppressed; see the docblock. */
  readonly onRead: (value: string) => void;
}

export interface UseBarcodeCameraResult {
  readonly support: BarcodeCameraSupport;
  readonly active: boolean;
  readonly error: BarcodeCameraError | null;
  /** The most recent accepted read, for the viewfinder's own confirmation. */
  readonly lastValue: string | null;
  readonly torchOn: boolean;
  /** Whether THIS device's camera exposes a torch. Most rear cameras do. */
  readonly torchAvailable: boolean;
  readonly start: () => void;
  readonly stop: () => void;
  readonly toggleTorch: () => void;
  /** Attach to the `<video>` the viewfinder renders. */
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function useBarcodeCamera({ onRead }: UseBarcodeCameraOptions): UseBarcodeCameraResult {
  const [support] = useState<BarcodeCameraSupport>(() => resolveBarcodeCameraSupport());
  const [active, setActive] = useState(false);
  const [error, setError] = useState<BarcodeCameraError | null>(null);
  const [lastValue, setLastValue] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAcceptedRef = useRef<{ value: string; at: number } | null>(null);
  // Read inside the decode loop, which is registered once — a dep on the
  // callback would tear the camera down and back up on every parent render.
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // Every track, not just video: a stream left running holds the camera and
    // its indicator light, which a packer reads as being watched.
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    setActive(false);
    setTorchOn(false);
    setTorchAvailable(false);
  }, []);

  const start = useCallback(() => {
    if (support !== 'ready') return;
    setError(null);
    setLastValue(null);
    lastAcceptedRef.current = null;
    setActive(true);
  }, [support]);

  // Stops on unmount, whatever route took the packer away from the box.
  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!active) return;

    const Detector = detectorConstructor();
    if (Detector === null) {
      setError('failed');
      setActive(false);
      return;
    }

    let cancelled = false;
    const detector = new Detector({ formats: [...BARCODE_FORMATS] });

    const run = async (): Promise<void> => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The REAR camera. A bench phone pointed at a box with the selfie
          // camera reads nothing and looks broken.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (cause) {
        if (cancelled) return;
        const name = cause instanceof Error ? cause.name : '';
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'permission-denied'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'no-device'
              : 'failed'
        );
        setActive(false);
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      // `torch` is not in the standard `MediaTrackCapabilities`, so it is read
      // defensively rather than typed into existence.
      const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      setTorchAvailable(capabilities?.torch === true);

      const video = videoRef.current;
      if (video !== null) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // Autoplay refusal on a video with no audio is rare and recoverable
          // by the packer tapping the frame; it is not worth an error state.
        }
      }

      timerRef.current = setInterval(() => {
        const element = videoRef.current;
        if (element === null || element.readyState < 2) return;
        void detector
          .detect(element)
          .then((found) => {
            const value = found[0]?.rawValue?.trim();
            if (value === undefined || value.length === 0) return;

            const previous = lastAcceptedRef.current;
            const now = Date.now();
            if (
              previous !== null &&
              previous.value === value &&
              now - previous.at < REPEAT_SUPPRESSION_MS
            ) {
              return;
            }
            lastAcceptedRef.current = { value, at: now };
            setLastValue(value);
            onReadRef.current(value);
          })
          .catch(() => {
            // One unreadable frame is the normal case while the packer aims.
          });
      }, DECODE_INTERVAL_MS);
    };

    void run();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    };
  }, [active]);

  const toggleTorch = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (track === undefined) return;
    const next = !torchOn;
    void track
      // `torch` is a real constraint on Android Chrome and is absent from the
      // DOM typings, so the object is widened through `unknown` rather than
      // asserted onto a type that genuinely does not contain it.
      .applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints)
      .then(() => {
        setTorchOn(next);
      })
      .catch(() => {
        // The device said no. Leave the control as it was rather than showing
        // a torch that is not on.
        setTorchAvailable(false);
      });
  }, [torchOn]);

  return {
    support,
    active,
    error,
    lastValue,
    torchOn,
    torchAvailable,
    start,
    stop,
    toggleTorch,
    videoRef,
  };
}

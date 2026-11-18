// app/components/studio/PhotoCalibrator.tsx
// „Calibrare din fotografie / cameră live”: utilizatorul trage 4 pini pe colțurile podelei, 2 pini pe o
// referință verticală cunoscută (ușă standard 2,10 m sau valoare proprie) și, opțional, un pin pe tavan deasupra
// colțului A. Calculul proiectiv este în `lib/studio/perspective.ts` (pur, testat).
// Sursa imaginii: fotografia activă din Studio · fișier · camera dispozitivului (getUserMedia, cu fallback la fișier).
"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Upload } from 'lucide-react';
import { tr } from '@/app/lib/i18n';
import { getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import {
  REFERENCE_PRESETS,
  applyHomography,
  calibrateFromPhoto,
  defaultPins,
  solveHomography,
  type CalibrationOutcome,
  type Pt,
} from '@/app/lib/studio/perspective';

type PinKey = 'A' | 'B' | 'C' | 'D' | 'refBottom' | 'refTop' | 'ceiling';

interface Pins {
  floor: [Pt, Pt, Pt, Pt];
  refBottom: Pt;
  refTop: Pt;
  ceiling: Pt;
}

interface Props {
  lang: Language;
  isDark: boolean;
  /** Fotografia activă din Studio (data URL), dacă există. */
  studioPhoto?: string | null;
  onResult: (result: CalibrationOutcome | null) => void;
}

const FLOOR_KEYS: PinKey[] = ['A', 'B', 'C', 'D'];

export default function PhotoCalibrator({ lang, isDark, studioPhoto, onResult }: Props) {
  const sk = getSkin(isDark);
  const t = (ro: string, en: string, fr?: string) => tr(lang, ro, en, fr);
  const [image, setImage] = useState<{ src: string; w: number; h: number; objectUrl?: boolean } | null>(null);
  const [pins, setPins] = useState<Pins | null>(null);
  const [refId, setRefId] = useState<string>(REFERENCE_PRESETS[0].id);
  const [customRef, setCustomRef] = useState('2.10');
  const [measureHeight, setMeasureHeight] = useState(true);
  const [dragging, setDragging] = useState<PinKey | null>(null);
  const [camera, setCamera] = useState<'off' | 'starting' | 'live' | 'error'>('off');
  const [loadError, setLoadError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refHeightM = refId === 'custom'
    ? Number(customRef.replace(',', '.'))
    : REFERENCE_PRESETS.find((p) => p.id === refId)?.heightM ?? 2.1;

  const result = useMemo<CalibrationOutcome | null>(() => {
    if (!image || !pins || !(refHeightM > 0)) return null;
    return calibrateFromPhoto({
      imageWidth: image.w,
      imageHeight: image.h,
      floor: pins.floor,
      refBottom: pins.refBottom,
      refTop: pins.refTop,
      refHeightM,
      ceiling: measureHeight ? pins.ceiling : null,
    });
  }, [image, pins, refHeightM, measureHeight]);

  useEffect(() => {
    onResult(result);
  }, [result, onResult]);

  // ── Surse de imagine ──
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((tk) => tk.stop());
    streamRef.current = null;
  };
  useEffect(() => () => stopCamera(), []);
  useEffect(() => () => {
    if (image?.objectUrl) URL.revokeObjectURL(image.src);
  }, [image]);

  const loadImage = (src: string, objectUrl = false) => {
    setLoadError(null);
    const img = new window.Image();
    img.onload = () => {
      setImage({ src, w: img.naturalWidth, h: img.naturalHeight, objectUrl });
      setPins(defaultPins(img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => setLoadError(t('Imaginea nu a putut fi citită.', 'The image could not be read.', 'Impossible de lire l’image.'));
    img.src = src;
  };

  const startCamera = async () => {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('error');
      return;
    }
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      streamRef.current = stream;
      setCamera('live');
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      });
    } catch {
      setCamera('error');
    }
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    stopCamera();
    setCamera('off');
    loadImage(c.toDataURL('image/jpeg', 0.9));
  };

  // ── Tragerea pinilor (coordonate SVG = pixeli de imagine) ──
  const toImage = (clientX: number, clientY: number): Pt | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m || !image) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: Math.min(image.w, Math.max(0, p.x)), y: Math.min(image.h, Math.max(0, p.y)) };
  };
  const setPin = (key: PinKey, p: Pt) =>
    setPins((prev) => {
      if (!prev) return prev;
      if (key === 'refBottom' || key === 'refTop' || key === 'ceiling') return { ...prev, [key]: p };
      const floor = [...prev.floor] as Pins['floor'];
      floor[FLOOR_KEYS.indexOf(key)] = p;
      return { ...prev, floor };
    });
  const getPin = (key: PinKey): Pt =>
    !pins ? { x: 0, y: 0 } : key === 'refBottom' || key === 'refTop' || key === 'ceiling' ? pins[key] : pins.floor[FLOOR_KEYS.indexOf(key)];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    const p = toImage(e.clientX, e.clientY);
    if (p) setPin(dragging, p);
  };

  const onPinKey = (key: PinKey, e: React.KeyboardEvent) => {
    if (!image) return;
    const step = Math.max(image.w, image.h) * (e.shiftKey ? 0.02 : 0.004);
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const mv = d[e.key];
    if (!mv) return;
    e.preventDefault();
    const p = getPin(key);
    setPin(key, { x: Math.min(image.w, Math.max(0, p.x + mv[0])), y: Math.min(image.h, Math.max(0, p.y + mv[1])) });
  };

  // ── Desen ──
  const bordeaux = isDark ? '#C94A6A' : '#5C1628';
  const brass = isDark ? '#C49A6C' : '#A67C52';
  const ink = isDark ? '#F5F2EF' : '#FFFFFF';
  const u = image ? Math.max(image.w, image.h) : 1000;
  const r = u * 0.011;
  const fs = u * 0.017;

  const grid = useMemo(() => {
    if (!pins || !result || !result.ok) return [] as [Pt, Pt][];
    const Hm = solveHomography([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], pins.floor);
    if (!Hm) return [];
    const lines: [Pt, Pt][] = [];
    const [ab, bc] = result.sides;
    for (let k = 1; k * 0.5 < ab - 0.05; k++) {
      const s = (k * 0.5) / ab;
      lines.push([applyHomography(Hm, { x: s, y: 0 }), applyHomography(Hm, { x: s, y: 1 })]);
    }
    for (let k = 1; k * 0.5 < bc - 0.05; k++) {
      const s = (k * 0.5) / bc;
      lines.push([applyHomography(Hm, { x: 0, y: s }), applyHomography(Hm, { x: 1, y: s })]);
    }
    return lines.length > 400 ? [] : lines;
  }, [pins, result]);

  const pinLabel: Record<PinKey, string> = {
    A: 'A', B: 'B', C: 'C', D: 'D',
    refBottom: t('Bază referință', 'Reference base', 'Base de référence'),
    refTop: t('Vârf referință', 'Reference top', 'Sommet de référence'),
    ceiling: t('Tavan (deasupra lui A)', 'Ceiling (above A)', 'Plafond (au-dessus de A)'),
  };

  const sourceBtn = `inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-medium cursor-pointer touch-manipulation ${sk.btnGhost}`;

  return (
    <div className="space-y-3">
      {/* Sursa fotografiei */}
      <div className="flex flex-wrap gap-2">
        {studioPhoto && (
          <button type="button" className={sourceBtn} onClick={() => { stopCamera(); setCamera('off'); loadImage(studioPhoto); }}>
            <ImageIcon className="w-4 h-4" aria-hidden /> {t('Fotografia din Studio', 'Studio photo', 'Photo du Studio')}
          </button>
        )}
        <button type="button" className={sourceBtn} onClick={() => fileRef.current?.click()}>
          <Upload className="w-4 h-4" aria-hidden /> {t('Încarcă fotografie', 'Upload photo', 'Importer une photo')}
        </button>
        <button type="button" className={sourceBtn} onClick={startCamera} disabled={camera === 'starting'}>
          <Camera className="w-4 h-4" aria-hidden /> {t('Cameră live', 'Live camera', 'Caméra en direct')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            stopCamera();
            setCamera('off');
            loadImage(URL.createObjectURL(f), true);
          }}
        />
      </div>

      {camera === 'error' && (
        <p role="alert" className={`text-[12px] ${sk.muted}`}>
          {t(
            'Camera nu este disponibilă (permisiune refuzată sau conexiune fără HTTPS). Folosește „Încarcă fotografie” — pe telefon se deschide direct camera.',
            'The camera is unavailable (permission denied or no HTTPS). Use “Upload photo” — on a phone it opens the camera directly.',
            'La caméra est indisponible (autorisation refusée ou pas de HTTPS). Utilisez « Importer une photo » — sur mobile, la caméra s’ouvre directement.',
          )}
        </p>
      )}
      {loadError && <p role="alert" className="text-[12px] text-red-500">{loadError}</p>}

      {camera === 'live' || camera === 'starting' ? (
        <div className={`relative overflow-hidden rounded-lg border ${sk.line} bg-black`}>
          <video ref={videoRef} playsInline muted className="w-full max-h-[52vh] object-contain" />
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2">
            <button type="button" onClick={capture} className={`inline-flex items-center gap-1.5 h-10 px-5 rounded-full text-[13px] font-medium cursor-pointer ${sk.btn}`}>
              <Camera className="w-4 h-4" aria-hidden /> {t('Capturează', 'Capture', 'Capturer')}
            </button>
            <button type="button" onClick={() => { stopCamera(); setCamera('off'); }} className="inline-flex items-center h-10 px-4 rounded-full text-[13px] bg-white/15 text-white backdrop-blur cursor-pointer">
              {t('Anulează', 'Cancel', 'Annuler')}
            </button>
          </div>
        </div>
      ) : image && pins ? (
        <div className={`relative overflow-hidden rounded-lg border ${sk.line} ${isDark ? 'bg-[#0B0809]' : 'bg-[#F5F2EF]'}`}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${image.w} ${image.h}`}
            preserveAspectRatio="xMidYMid meet"
            className="block w-full max-h-[52vh] touch-none select-none"
            onPointerMove={onMove}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
            onPointerLeave={() => setDragging(null)}
            role="group"
            aria-label={t('Fotografie cu pini de calibrare', 'Photo with calibration pins', 'Photo avec repères de calibrage')}
          >
            <image href={image.src} x={0} y={0} width={image.w} height={image.h} />
            <polygon
              points={pins.floor.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={bordeaux}
              fillOpacity={0.14}
              stroke={bordeaux}
              strokeWidth={u * 0.0028}
              strokeLinejoin="round"
            />
            {grid.map(([a, b], i) => (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ink} strokeOpacity={0.55} strokeWidth={u * 0.0012} />
            ))}
            {/* Laturile în metri */}
            {result?.ok && pins.floor.map((p, i) => {
              const q = pins.floor[(i + 1) % 4];
              return (
                <text key={i} x={(p.x + q.x) / 2} y={(p.y + q.y) / 2 - r * 1.4} textAnchor="middle" fontSize={fs} fontFamily="ui-monospace, monospace" fontWeight={600} fill={ink} stroke={bordeaux} strokeWidth={fs * 0.22} paintOrder="stroke">
                  {result.sides[i].toFixed(2).replace('.', ',')} m
                </text>
              );
            })}
            {/* Referința verticală */}
            <line x1={pins.refBottom.x} y1={pins.refBottom.y} x2={pins.refTop.x} y2={pins.refTop.y} stroke={brass} strokeWidth={u * 0.004} strokeLinecap="round" />
            <text x={pins.refTop.x + r * 1.6} y={(pins.refTop.y + pins.refBottom.y) / 2} fontSize={fs} fontFamily="ui-monospace, monospace" fontWeight={600} fill={ink} stroke={brass} strokeWidth={fs * 0.22} paintOrder="stroke">
              {(refHeightM || 0).toFixed(2).replace('.', ',')} m
            </text>
            {measureHeight && (
              <line x1={pins.floor[0].x} y1={pins.floor[0].y} x2={pins.ceiling.x} y2={pins.ceiling.y} stroke={bordeaux} strokeWidth={u * 0.0025} strokeDasharray={`${u * 0.01} ${u * 0.007}`} />
            )}
            {(['A', 'B', 'C', 'D', 'refBottom', 'refTop', ...(measureHeight ? ['ceiling'] : [])] as PinKey[]).map((key) => {
              const p = getPin(key);
              const isRef = key === 'refBottom' || key === 'refTop';
              const color = isRef ? brass : bordeaux;
              return (
                <g
                  key={key}
                  tabIndex={0}
                  role="slider"
                  aria-label={pinLabel[key]}
                  aria-valuetext={`${Math.round(p.x)}, ${Math.round(p.y)}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(e.pointerId);
                    setDragging(key);
                  }}
                  onKeyDown={(e) => onPinKey(key, e)}
                  className="cursor-grab outline-none focus-visible:[&>circle:nth-child(2)]:stroke-[#A67C52]"
                >
                  <circle cx={p.x} cy={p.y} r={r * 2.4} fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={dragging === key ? r * 1.25 : r} fill={color} stroke={ink} strokeWidth={u * 0.0025} />
                  {!isRef && key !== 'ceiling' && (
                    <text x={p.x} y={p.y + fs * 0.36} textAnchor="middle" fontSize={fs * 0.95} fontWeight={700} fill={ink} pointerEvents="none">
                      {key}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className={`rounded-lg border border-dashed ${sk.line} px-6 py-10 text-center`}>
          <p className={`text-[13px] ${sk.muted}`}>
            {t(
              'Alege fotografia din Studio, încarcă o imagine sau deschide camera. Fotografiază camera dintr-un colț, cu podeaua și o ușă vizibile.',
              'Pick the Studio photo, upload an image or open the camera. Shoot the room from a corner with the floor and a door visible.',
              'Choisissez la photo du Studio, importez une image ou ouvrez la caméra. Photographiez la pièce depuis un coin, sol et porte visibles.',
            )}
          </p>
        </div>
      )}

      {/* Referința + opțiuni */}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] items-end">
        <label className="block">
          <span className={`block text-[11px] mb-1 ${sk.muted}`}>{t('Referință verticală (înălțime cunoscută)', 'Vertical reference (known height)', 'Référence verticale (hauteur connue)')}</span>
          <select value={refId} onChange={(e) => setRefId(e.target.value)} className={`w-full h-9 rounded-md border px-2 text-[13px] ${sk.input}`}>
            {REFERENCE_PRESETS.map((p) => (
              <option key={p.id} value={p.id} className={sk.option}>
                {t(p.ro, p.en, p.fr)} · {p.heightM.toFixed(2).replace('.', ',')} m
              </option>
            ))}
            <option value="custom" className={sk.option}>{t('Altă înălțime (introdu valoarea)', 'Custom height', 'Hauteur personnalisée')}</option>
          </select>
        </label>
        {refId === 'custom' && (
          <label className="block">
            <span className={`block text-[11px] mb-1 ${sk.muted}`}>{t('Înălțime (m)', 'Height (m)', 'Hauteur (m)')}</span>
            <input
              inputMode="decimal"
              value={customRef}
              onChange={(e) => setCustomRef(e.target.value)}
              className={`w-28 h-9 rounded-md border px-2 font-mono text-[13px] ${sk.input}`}
            />
          </label>
        )}
      </div>
      <label className={`flex items-center gap-2 text-[12px] ${sk.muted} cursor-pointer`}>
        <input type="checkbox" checked={measureHeight} onChange={(e) => setMeasureHeight(e.target.checked)} className="accent-[#5C1628]" />
        {t('Măsoară și înălțimea camerei (pin pe tavan, vertical deasupra colțului A)', 'Also measure ceiling height (pin on the ceiling, straight above corner A)', 'Mesurer aussi la hauteur (repère au plafond, à la verticale de A)')}
      </label>

      <ol className={`list-decimal pl-5 space-y-0.5 text-[12px] ${sk.muted}`}>
        <li>{t('Trage pinii A → B → C → D pe cele 4 colțuri ale podelei, în ordine pe contur.', 'Drag pins A → B → C → D onto the 4 floor corners, in order around the room.', 'Placez A → B → C → D sur les 4 coins du sol, dans l’ordre.')}</li>
        <li>{t('Pune pinii șampanie pe baza și pe vârful referinței (ex. pragul și partea de sus a tocului ușii).', 'Put the champagne pins on the reference base and top (e.g. door sill and top of the frame).', 'Placez les repères champagne à la base et au sommet de la référence (ex. seuil et haut du cadre).')}</li>
        <li>{t('Opțional: pinul de tavan exact deasupra colțului A. Pinii se mută și cu săgețile (Shift = pas mare).', 'Optional: the ceiling pin straight above corner A. Pins also move with the arrow keys (Shift = big step).', 'Optionnel : le repère plafond au-dessus de A. Flèches pour déplacer (Maj = grand pas).')}</li>
      </ol>
    </div>
  );
}

// app/components/studio/IphoneBridgePanel.tsx
// „Scanează live cu iPhone (RoomPlan)” — cardul punții live din fereastra „Scanare LiDAR & Măsurare Cameră”.
// La montare cere un cod de 6 cifre (POST /api/studio/lidar/pair), apoi interoghează GET /api/studio/lidar/latest
// la 2,5 s (doar cu fila vizibilă). Când aplicația iOS trimite scanarea, fișierul (identic cu cel de pe iPhone) urcă
// la părinte prin `onScan`, care îl parsează cu `lidarParser.ts` exact ca la importul manual.
"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw, Smartphone, TriangleAlert, Wifi } from 'lucide-react';
import { ApiError, apiJson } from '@/app/lib/api-client';
import { tr } from '@/app/lib/i18n';
import { getSkin } from '@/app/lib/theme/skin';
import type { Language } from '@/app/types';
import {
  BRIDGE_POLL_MS,
  bridgeScanToFile,
  formatPairingCode,
  readLatest,
  secondsUntil,
  type LidarPairResponse,
} from '@/app/lib/studio/lidarBridge';

interface Props {
  lang: Language;
  isDark: boolean;
  /** Scanarea sosită de pe iPhone, ca fișier de browser (același nume și aceiași octeți). */
  onScan: (file: File) => void;
}

type Status =
  | { kind: 'pairing' }
  | { kind: 'waiting' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

const isLoopback = (url: string) => /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);

export default function IphoneBridgePanel({ lang, isDark, onScan }: Props) {
  const sk = getSkin(isDark);
  const t = useCallback((ro: string, en: string, fr?: string) => tr(lang, ro, en, fr), [lang]);
  const [pairing, setPairing] = useState<LidarPairResponse | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'pairing' });
  const [received, setReceived] = useState<{ fileName: string; at: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const errorMessage = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.isUnauthorized) {
      return t('Autentifică-te în SUCVAR pentru a asocia iPhone-ul.', 'Sign in to SUCVAR to pair your iPhone.', 'Connectez-vous à SUCVAR pour associer l’iPhone.');
    }
    if (e instanceof ApiError && e.message) return e.message;
    return t('Serverul SUCVAR nu răspunde. Verifică conexiunea și reîncearcă.', 'The SUCVAR server is not responding. Check the connection and retry.', 'Le serveur SUCVAR ne répond pas. Vérifiez la connexion et réessayez.');
  }, [t]);

  const pair = useCallback(async () => {
    setStatus({ kind: 'pairing' });
    setPairing(null);
    try {
      const p = await apiJson<LidarPairResponse>('/api/studio/lidar/pair', { method: 'POST', auth: true });
      setPairing(p);
      setStatus({ kind: 'waiting' });
    } catch (e) {
      setStatus({ kind: 'error', message: errorMessage(e) });
    }
  }, [errorMessage]);

  // Cod nou la deschidere. `pair` e amânat (microtask) ca setState să nu ruleze sincron în efect.
  useEffect(() => {
    let live = true;
    void Promise.resolve().then(() => {
      if (live) void pair();
    });
    return () => {
      live = false;
    };
  }, [pair]);

  // Ceasul pentru numărătoarea inversă a codului
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Interogarea blândă: o cerere odată, la 2,5 s după ce s-a terminat precedenta; pauză cât fila e ascunsă
  const code = pairing?.code;
  const waiting = status.kind === 'waiting';
  useEffect(() => {
    if (!code || !waiting) return;
    let stopped = false;
    let timer: number | undefined;
    const ctrl = new AbortController();
    const tick = async () => {
      if (stopped) return;
      let delay = BRIDGE_POLL_MS;
      if (!document.hidden) {
        try {
          const data = readLatest(await apiJson<unknown>(`/api/studio/lidar/latest?code=${code}`, { auth: true, signal: ctrl.signal }));
          if (stopped) return;
          if (data.hasNewScan) {
            const f = bridgeScanToFile(data);
            const file = new File([f.bytes.slice().buffer], f.name, { type: f.type });
            setReceived({ fileName: data.fileName, at: data.uploadedAtUtc });
            onScanRef.current(file);
          } else if (data.codeExpired) {
            setStatus({ kind: 'expired' });
            return;
          }
        } catch (e) {
          if (stopped || ctrl.signal.aborted) return;
          if (e instanceof ApiError && e.status === 404) {
            setStatus({ kind: 'expired' });
            return;
          }
          if (e instanceof ApiError && e.isUnauthorized) {
            setStatus({ kind: 'error', message: errorMessage(e) });
            return;
          }
          delay = e instanceof ApiError && e.status === 429 ? 15_000 : BRIDGE_POLL_MS * 2; // rețea: reîncercăm mai rar
        }
      }
      if (!stopped) timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, BRIDGE_POLL_MS);
    return () => {
      stopped = true;
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [code, waiting, errorMessage]);

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      /* clipboard indisponibil (http fără localhost) — textul rămâne selectabil */
    }
  };

  const left = pairing ? secondsUntil(pairing.expiresAtUtc, now) : 0;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const serverUrl = pairing?.serverUrl ?? pairing?.uploadUrl.replace(/\/api\/studio\/lidar\/upload$/, '');
  const accent = isDark ? 'text-[#E07F98]' : 'text-[#5C1628]';
  const mono = `font-mono text-[12px] break-all ${sk.strong}`;

  const copyBtn = (value: string, key: string, label: string) => (
    <button
      type="button"
      onClick={() => void copy(value, key)}
      aria-label={label}
      className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full cursor-pointer ${sk.btnGhost}`}
    >
      {copied === key ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
    </button>
  );

  return (
    <section
      aria-labelledby="iphone-bridge-title"
      className={`rounded-xl border px-4 py-4 space-y-3 ${sk.line} ${isDark ? 'bg-[#C94A6A]/[0.06]' : 'bg-[#5C1628]/[0.03]'}`}
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-full ${isDark ? 'bg-[#C94A6A]/15' : 'bg-[#5C1628]/[0.07]'} ${accent}`}>
          <Smartphone className="w-5 h-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id="iphone-bridge-title" className={`text-[14px] font-semibold ${sk.strong}`}>
            {t('Scanează live cu iPhone (RoomPlan)', 'Scan live with iPhone (RoomPlan)', 'Scanner en direct avec l’iPhone (RoomPlan)')}
          </h3>
          <p className={`text-[12px] ${sk.muted}`}>
            {t(
              'Introdu codul în aplicația RoomPlan de pe iPhone; scanarea apare aici automat, fără AirDrop sau transfer de fișiere.',
              'Enter the code in the RoomPlan app on your iPhone; the scan appears here automatically, no AirDrop or file transfer.',
              'Saisissez le code dans l’app RoomPlan de l’iPhone ; le scan apparaît ici automatiquement, sans AirDrop.',
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void pair()}
          disabled={status.kind === 'pairing'}
          className={`shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-medium cursor-pointer disabled:opacity-50 ${sk.btnGhost}`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${status.kind === 'pairing' ? 'animate-spin' : ''}`} aria-hidden />
          <span className="hidden sm:inline">{t('Generează cod nou', 'New code', 'Nouveau code')}</span>
        </button>
      </div>

      {status.kind === 'error' && (
        <div role="alert" className={`flex gap-2 rounded-lg border px-3 py-2 text-[13px] ${isDark ? 'border-[#C94A6A]/40 text-[#F2D7DE]' : 'border-[#5C1628]/25 text-[#5C1628]'}`}>
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <span>{status.message}</span>
        </div>
      )}

      {pairing && (
        <div className="grid sm:grid-cols-[auto_minmax(0,1fr)] gap-3 sm:gap-5 items-center">
          <div>
            <p className={`text-[11px] uppercase tracking-[0.14em] ${sk.dim}`}>{t('Cod de asociere', 'Pairing code', 'Code d’association')}</p>
            <div className="flex items-center gap-1.5">
              <span
                className={`font-mono tabular-nums text-[30px] leading-tight font-semibold tracking-[0.08em] ${status.kind === 'expired' ? `line-through opacity-50 ${sk.muted}` : sk.strong}`}
                aria-label={pairing.code.split('').join(' ')}
              >
                {formatPairingCode(pairing.code)}
              </span>
              {copyBtn(pairing.code, 'code', t('Copiază codul', 'Copy code', 'Copier le code'))}
            </div>
            <p className={`text-[11px] tabular-nums ${sk.dim}`}>
              {status.kind === 'expired'
                ? t('Cod expirat', 'Code expired', 'Code expiré')
                : t(`Expiră în ${mmss}`, `Expires in ${mmss}`, `Expire dans ${mmss}`)}
            </p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className={`text-[11px] uppercase tracking-[0.14em] flex items-center gap-1 ${sk.dim}`}>
              <Wifi className="w-3 h-3" aria-hidden /> {t('Server SUCVAR (Wi-Fi local)', 'SUCVAR server (local Wi-Fi)', 'Serveur SUCVAR (Wi-Fi local)')}
            </p>
            {serverUrl && (
              <div className="flex items-center gap-1.5">
                <code className={mono}>{serverUrl}</code>
                {copyBtn(serverUrl, 'server', t('Copiază adresa serverului', 'Copy server address', 'Copier l’adresse du serveur'))}
              </div>
            )}
            <p className={`text-[11px] ${sk.dim}`}>
              POST <span className="font-mono">/api/studio/lidar/upload</span>
            </p>
            {serverUrl && isLoopback(serverUrl) && (
              <p className={`text-[11px] ${accent}`}>
                {t(
                  'Adresa e locală (localhost): iPhone-ul nu o poate accesa. Pornește API-ul cu --urls http://0.0.0.0:5080 sau setează Lidar__PublicBaseUrl.',
                  'This is a localhost address the iPhone cannot reach. Start the API with --urls http://0.0.0.0:5080 or set Lidar__PublicBaseUrl.',
                  'Adresse locale (localhost) inaccessible depuis l’iPhone. Lancez l’API avec --urls http://0.0.0.0:5080 ou définissez Lidar__PublicBaseUrl.',
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {status.kind === 'waiting' && (
        <div role="status" aria-live="polite" className={`flex items-center gap-2.5 text-[13px] ${sk.muted}`}>
          <span className="relative inline-flex w-2.5 h-2.5" aria-hidden>
            <span className={`absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping ${isDark ? 'bg-[#E07F98]' : 'bg-[#5C1628]'}`} />
            <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${isDark ? 'bg-[#E07F98]' : 'bg-[#5C1628]'}`} />
          </span>
          {received
            ? t('Așteptăm o nouă scanare de pe iPhone…', 'Waiting for another scan from the iPhone…', 'En attente d’un nouveau scan depuis l’iPhone…')
            : t('Așteptăm scanarea de pe iPhone…', 'Waiting for the scan from the iPhone…', 'En attente du scan depuis l’iPhone…')}
        </div>
      )}

      {status.kind === 'expired' && (
        <p role="status" className={`text-[13px] ${sk.muted}`}>
          {t('Codul a expirat. Apasă „Generează cod nou” pentru a continua.', 'The code expired. Press “New code” to continue.', 'Le code a expiré. Cliquez sur « Nouveau code ».')}
        </p>
      )}

      {received && (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] ${isDark ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-emerald-700/25 bg-emerald-50 text-emerald-900'}`}
        >
          <Check className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <span>
            <strong className="font-semibold">{t('Scanare recepționată de pe iPhone!', 'Scan received from the iPhone!', 'Scan reçu depuis l’iPhone !')}</strong>{' '}
            <span className="opacity-80">
              {received.fileName} ·{' '}
              {t('verifică cotele, apoi aplică-le sau generează din proiectul 3D.', 'check the dimensions, then apply them or generate from the 3D project.', 'vérifiez les cotes, puis appliquez-les ou générez depuis le projet 3D.')}
            </span>
          </span>
        </div>
      )}
    </section>
  );
}

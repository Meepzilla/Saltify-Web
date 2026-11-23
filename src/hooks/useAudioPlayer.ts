import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_PLAYBACK_BOOST = 4.0; // 400% (+12 dB) with soft limiter
export const VOLUME_BOOST_PRESETS = [1.0, 1.5, 2.0, 3.0, 4.0] as const;

export interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number; // 0.0 .. 4.0 (1.0 = 100%, 4.0 = 400% / +12 dB)
  muted: boolean;
  ready: boolean;
  togglePlayPause: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number, autoPlayIfPlaying?: boolean) => void;
  skip: (deltaSeconds: number) => void;
  restart: () => void;
  setPlaybackRate: (rate: number) => void;
  setVolume: (gain: number) => void;
  toggleMute: () => void;
  cycleBoost: () => void;
}

interface WebAudioBoostGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  limiter: DynamicsCompressorNode;
}

/**
 * Reliable cross-platform audio player backed by HTMLAudioElement + Web Audio API
 * GainNode + soft DynamicsCompressorNode limiter.
 *
 * Unlike native <audio>.volume (capped at 100% and read-only on iPadOS Safari),
 * routing through a lazily initialized Web Audio GainNode allows clean 0%–400%
 * (+12 dB) output volume boosting on Android, Windows, AND iPadOS Safari while
 * soft-limiting sudden spikes to prevent clipping.
 */
export function useAudioPlayer(
  audioBlob: Blob | null,
  fallbackDuration = 0,
  initialVolume = 1.5,
  onVolumeChange?: (volume: number) => void,
  onError?: (message: string) => void
): AudioPlayerState {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graphRef = useRef<WebAudioBoostGraph | null>(null);
  const urlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [volume, setVolumeState] = useState(() =>
    Math.max(0, Math.min(MAX_PLAYBACK_BOOST, Number.isFinite(initialVolume) ? initialVolume : 1.5))
  );
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);

  const volumeRef = useRef(volume);
  const mutedRef = useRef(muted);
  volumeRef.current = volume;
  mutedRef.current = muted;

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startRaf = useCallback(() => {
    stopRaf();
    const tick = () => {
      const el = audioRef.current;
      if (!el || el.paused) {
        rafRef.current = null;
        return;
      }
      setCurrentTime(el.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopRaf]);

  const teardownGraph = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graphRef.current = null;
    try {
      graph.source.disconnect();
      graph.gain.disconnect();
      graph.limiter.disconnect();
    } catch {
      // ignore disconnect errors
    }
    graph.ctx.close().catch(() => {});
  }, []);

  const applyEffectiveGain = useCallback((gainVal: number, isMuted: boolean) => {
    const effective = isMuted ? 0 : Math.max(0, Math.min(MAX_PLAYBACK_BOOST, gainVal));
    const graph = graphRef.current;
    if (graph) {
      try {
        graph.gain.gain.setTargetAtTime(effective, graph.ctx.currentTime, 0.015);
      } catch {
        graph.gain.gain.value = effective;
      }
      if (audioRef.current) {
        audioRef.current.volume = 1;
        audioRef.current.muted = false;
      }
    } else if (audioRef.current) {
      audioRef.current.muted = isMuted;
      audioRef.current.volume = Math.min(1, effective);
    }
  }, []);

  /**
   * Lazily initializes & resumes the Web Audio boost + soft-limiter chain inside
   * a user gesture so iPadOS Safari never suspends or silences playback.
   */
  const ensureBoostGraph = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;

    if (!graphRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      try {
        const ctx = new AudioCtx();
        const source = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        const limiter = ctx.createDynamicsCompressor();

        // Gentle broadcast soft-limiter protects ears when boosting soft child voices up to +12 dB
        limiter.threshold.value = -5;
        limiter.knee.value = 12;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;

        const effective = mutedRef.current ? 0 : volumeRef.current;
        gain.gain.value = effective;
        el.volume = 1;
        el.muted = false;

        source.connect(gain);
        gain.connect(limiter);
        limiter.connect(ctx.destination);

        graphRef.current = { ctx, source, gain, limiter };
      } catch {
        // Fallback cleanly to native <audio> if Web Audio graph creation fails
        return;
      }
    }

    if (graphRef.current.ctx.state === 'suspended') {
      await graphRef.current.ctx.resume().catch(() => {});
    }
    applyEffectiveGain(volumeRef.current, mutedRef.current);
  }, [applyEffectiveGain]);

  useEffect(() => {
    setDuration(fallbackDuration);
  }, [fallbackDuration]);

  useEffect(() => {
    stopRaf();
    teardownGraph();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }

    setIsPlaying(false);
    setCurrentTime(0);

    if (!audioBlob) {
      setReady(false);
      setDuration(0);
      return;
    }

    const url = URL.createObjectURL(audioBlob);
    urlRef.current = url;

    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = url;
    audio.playbackRate = playbackRate;
    audio.volume = Math.min(1, mutedRef.current ? 0 : volumeRef.current);
    audio.muted = mutedRef.current;
    // Enable inline playback on iOS/iPadOS Safari
    audio.setAttribute('playsinline', 'true');
    audioRef.current = audio;

    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
      setReady(true);
    };
    const onPlay = () => {
      setIsPlaying(true);
      startRaf();
    };
    const onPause = () => {
      setIsPlaying(false);
      stopRaf();
      setCurrentTime(audio.currentTime);
    };
    const onEnded = () => {
      setIsPlaying(false);
      stopRaf();
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onAudioError = () => {
      setIsPlaying(false);
      stopRaf();
      onError?.('Could not play this audio file on this device.');
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', onAudioError);

    setReady(true);

    return () => {
      stopRaf();
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onAudioError);
      audio.src = '';
      teardownGraph();
      if (urlRef.current === url) {
        URL.revokeObjectURL(url);
        urlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioBlob]);

  const play = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      await ensureBoostGraph();
      await el.play();
    } catch (err) {
      onError?.(
        err instanceof Error
          ? `Audio playback failed: ${err.message}`
          : 'Audio playback was blocked by the browser.'
      );
    }
  }, [ensureBoostGraph, onError]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const togglePlayPause = useCallback(async () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      await play();
    } else {
      el.pause();
    }
  }, [play]);

  const seek = useCallback(
    (seconds: number, autoPlayIfPlaying = false) => {
      const el = audioRef.current;
      if (!el) return;
      const maxDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
      const clamped = Math.max(0, Math.min(seconds, maxDur || seconds));
      el.currentTime = clamped;
      setCurrentTime(clamped);
      if (autoPlayIfPlaying && el.paused) {
        void play();
      }
    },
    [duration, play]
  );

  const skip = useCallback(
    (deltaSeconds: number) => {
      const el = audioRef.current;
      if (!el) return;
      seek(el.currentTime + deltaSeconds);
    },
    [seek]
  );

  const restart = useCallback(() => {
    seek(0);
  }, [seek]);

  const setPlaybackRate = useCallback((rate: number) => {
    setPlaybackRateState(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const setVolume = useCallback(
    (gain: number) => {
      const clamped = Math.max(0, Math.min(MAX_PLAYBACK_BOOST, Number(gain.toFixed(2))));
      setVolumeState(clamped);
      const nextMuted = clamped === 0;
      setMuted(nextMuted);
      volumeRef.current = clamped;
      mutedRef.current = nextMuted;
      applyEffectiveGain(clamped, nextMuted);
      onVolumeChange?.(clamped);
    },
    [applyEffectiveGain, onVolumeChange]
  );

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    setMuted(nextMuted);
    mutedRef.current = nextMuted;
    // If unmuting from 0, restore to 100%
    if (!nextMuted && volumeRef.current === 0) {
      setVolumeState(1.0);
      volumeRef.current = 1.0;
      onVolumeChange?.(1.0);
    }
    applyEffectiveGain(volumeRef.current, nextMuted);
  }, [applyEffectiveGain, onVolumeChange]);

  const cycleBoost = useCallback(() => {
    const current = mutedRef.current ? 0 : volumeRef.current;
    const next =
      VOLUME_BOOST_PRESETS.find((preset) => preset > current + 0.05) ??
      VOLUME_BOOST_PRESETS[0];
    setVolume(next);
  }, [setVolume]);

  return {
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    volume,
    muted,
    ready,
    togglePlayPause,
    play,
    pause,
    seek,
    skip,
    restart,
    setPlaybackRate,
    setVolume,
    toggleMute,
    cycleBoost,
  };
}

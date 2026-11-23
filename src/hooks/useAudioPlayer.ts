import { useCallback, useEffect, useRef, useState } from 'react';

export interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  ready: boolean;
  togglePlayPause: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number, autoPlayIfPlaying?: boolean) => void;
  skip: (deltaSeconds: number) => void;
  restart: () => void;
  setPlaybackRate: (rate: number) => void;
}

/**
 * Reliable cross-platform audio player backed by HTMLAudioElement + WAV Blob URL.
 * Works consistently across Android Chrome, Windows Edge/Chrome, and iPadOS Safari
 * with smooth requestAnimationFrame playhead tracking and playback speed control.
 */
export function useAudioPlayer(
  audioBlob: Blob | null,
  fallbackDuration = 0,
  onError?: (message: string) => void
): AudioPlayerState {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(fallbackDuration);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [ready, setReady] = useState(false);

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

  useEffect(() => {
    setDuration(fallbackDuration);
  }, [fallbackDuration]);

  useEffect(() => {
    stopRaf();
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
      await el.play();
    } catch (err) {
      onError?.(
        err instanceof Error
          ? `Audio playback failed: ${err.message}`
          : 'Audio playback was blocked by the browser.'
      );
    }
  }, [onError]);

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

  return {
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    ready,
    togglePlayPause,
    play,
    pause,
    seek,
    skip,
    restart,
    setPlaybackRate,
  };
}

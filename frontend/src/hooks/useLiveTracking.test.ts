// Tests du hook useLiveTracking : options de watchPosition, mises à jour de
// position, stop/clearWatch, cleanup au démontage, messages d'erreur, et la
// fonction pure haversineDistanceMeters (cas numériques vérifiables).
// navigator.geolocation est mocké — jsdom n'implémente pas cette API.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { haversineDistanceMeters, useLiveTracking } from '@/hooks/useLiveTracking';

type WatchArgs = [
  success: PositionCallback,
  error: PositionErrorCallback | null,
  options?: PositionOptions,
];

function mockGeolocation() {
  const watchPosition = vi.fn((_s: unknown, _e: unknown, _o: unknown) => 42);
  const clearWatch = vi.fn();
  const getCurrentPosition = vi.fn();
  const geo = { watchPosition, clearWatch, getCurrentPosition };
  Object.defineProperty(window.navigator, 'geolocation', {
    value: geo,
    configurable: true,
    writable: true,
  });
  return geo;
}

function errorWithCode(code: number): GeolocationPositionError {
  return {
    code,
    message: 'mock error',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

afterEach(() => {
  // jsdom n'a pas de geolocation native : on supprime le mock entre tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window.navigator as any).geolocation;
  vi.restoreAllMocks();
});

describe('useLiveTracking', () => {
  it('start() appelle watchPosition avec les bonnes options et passe en suivi', () => {
    const geo = mockGeolocation();
    const { result } = renderHook(() => useLiveTracking());

    expect(result.current.isTracking).toBe(false);
    expect(result.current.position).toBeNull();

    act(() => {
      result.current.start();
    });

    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    const [, , options] = geo.watchPosition.mock.calls[0] as unknown as WatchArgs;
    expect(options).toEqual({
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000,
    });
    expect(result.current.isTracking).toBe(true);
  });

  it('chaque callback de position met à jour l’état', () => {
    mockGeolocation();
    const { result } = renderHook(() => useLiveTracking());

    act(() => {
      result.current.start();
    });
    const geo = window.navigator.geolocation;
    const watchMock = vi.mocked(geo.watchPosition);
    const [onSuccess] = watchMock.mock.calls[0] as unknown as WatchArgs;

    act(() => {
      onSuccess({
        coords: { latitude: 5.32, longitude: -4.02, accuracy: 12 },
      } as GeolocationPosition);
    });
    expect(result.current.position).toEqual({ lat: 5.32, lon: -4.02, accuracy: 12 });

    act(() => {
      onSuccess({
        coords: { latitude: 5.33, longitude: -4.01, accuracy: 8 },
      } as GeolocationPosition);
    });
    expect(result.current.position).toEqual({ lat: 5.33, lon: -4.01, accuracy: 8 });
  });

  it('stop() appelle clearWatch avec le bon id et repasse au repos', () => {
    const geo = mockGeolocation();
    const { result } = renderHook(() => useLiveTracking());

    act(() => {
      result.current.start();
    });
    const [onSuccess] = geo.watchPosition.mock.calls[0] as unknown as WatchArgs;
    act(() => {
      onSuccess({
        coords: { latitude: 5.32, longitude: -4.02, accuracy: 12 },
      } as GeolocationPosition);
    });
    act(() => {
      result.current.stop();
    });

    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
    expect(result.current.isTracking).toBe(false);
    // Le dernier point connu est conservé (la carte garde le marqueur).
    expect(result.current.position).toEqual({ lat: 5.32, lon: -4.02, accuracy: 12 });
  });

  it('le démontage pendant un suivi actif appelle clearWatch (pas de watch orphelin)', () => {
    const geo = mockGeolocation();
    const { result, unmount } = renderHook(() => useLiveTracking());

    act(() => {
      result.current.start();
    });
    unmount();

    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
  });

  it('permission refusée → message clair, pas de suivi', () => {
    mockGeolocation();
    const { result } = renderHook(() => useLiveTracking());

    act(() => {
      result.current.start();
    });
    const geo = window.navigator.geolocation;
    const [, onError] = vi.mocked(geo.watchPosition).mock.calls[0] as unknown as WatchArgs;

    act(() => {
      onError?.(errorWithCode(1));
    });

    expect(result.current.error).toContain('Permission de géolocalisation refusée');
    expect(result.current.isTracking).toBe(false);
  });

  it('timeout → message clair', () => {
    mockGeolocation();
    const { result } = renderHook(() => useLiveTracking());

    act(() => {
      result.current.start();
    });
    const geo = window.navigator.geolocation;
    const [, onError] = vi.mocked(geo.watchPosition).mock.calls[0] as unknown as WatchArgs;

    act(() => {
      onError?.(errorWithCode(3));
    });

    expect(result.current.error).toContain('Délai de géolocalisation dépassé');
    expect(result.current.isTracking).toBe(false);
  });

  it('géolocalisation absente → message clair sans appeler watchPosition', () => {
    const { result } = renderHook(() => useLiveTracking());

    act(() => {
      result.current.start();
    });

    expect(result.current.error).toContain("n'est pas disponible");
    expect(result.current.isTracking).toBe(false);
  });

  it('redémarrer deux fois ne laisse qu’un seul watch actif', () => {
    const geo = mockGeolocation();
    const { result } = renderHook(() => useLiveTracking());

    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.start();
    });

    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    // L'ancien watch (id 42) est nettoyé avant d'en ouvrir un nouveau.
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
  });
});

describe('haversineDistanceMeters', () => {
  it('retourne 0 pour deux points identiques', () => {
    expect(haversineDistanceMeters({ lat: 5.32, lon: -4.02 }, { lat: 5.32, lon: -4.02 })).toBe(0);
  });

  it('1 degré de latitude sur un même méridien ≈ 111 195 m', () => {
    const d = haversineDistanceMeters({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(Math.abs(d - 111194.9)).toBeLessThan(1);
  });

  it('deux points à ~1 km d’écart en latitude (Abidjan)', () => {
    // 0,009° de latitude ≈ 1 000 m.
    const d = haversineDistanceMeters({ lat: 5.32, lon: -4.02 }, { lat: 5.329, lon: -4.02 });
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });

  it('est symétrique', () => {
    const a = { lat: 5.32, lon: -4.02 };
    const b = { lat: 5.35, lon: -4.0 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });
});

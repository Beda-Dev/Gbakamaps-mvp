// Tests du hook useDeviceOrientation : détection de fonctionnalité,
// conversion alpha→cap, cas iOS (requestPermission statique simulée) vs
// Android/desktop (pas de permission), et bearingBetween/cardinalLabel
// (purs calculs, aucune dépendance navigateur).
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bearingBetween, cardinalLabel, useDeviceOrientation } from '@/hooks/useDeviceOrientation';

describe('bearingBetween', () => {
  it('un point plein Nord donne un cap de 0°', () => {
    const bearing = bearingBetween({ lat: 5.3, lon: -4.0 }, { lat: 5.4, lon: -4.0 });
    expect(bearing).toBeCloseTo(0, 0);
  });

  it('un point plein Est donne un cap proche de 90°', () => {
    const bearing = bearingBetween({ lat: 5.3, lon: -4.0 }, { lat: 5.3, lon: -3.9 });
    expect(bearing).toBeGreaterThan(85);
    expect(bearing).toBeLessThan(95);
  });
});

describe('cardinalLabel', () => {
  it('mappe les caps aux points cardinaux attendus', () => {
    expect(cardinalLabel(0)).toBe('Nord');
    expect(cardinalLabel(90)).toBe('Est');
    expect(cardinalLabel(180)).toBe('Sud');
    expect(cardinalLabel(270)).toBe('Ouest');
    expect(cardinalLabel(359)).toBe('Nord');
  });
});

describe('useDeviceOrientation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error -- nettoyage du stub statique ajouté par le test iOS
    delete (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent
      ?.requestPermission;
  });

  it("sans DeviceOrientationEvent dans l'environnement, isSupported est false", () => {
    const original = (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
    // @ts-expect-error -- simulation d'un navigateur sans l'API
    delete globalThis.DeviceOrientationEvent;
    const { result } = renderHook(() => useDeviceOrientation());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.heading).toBeNull();
    (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent = original;
  });

  it("Android/desktop (pas de requestPermission statique) : requestPermission() attache directement sans rien demander", async () => {
    const { result } = renderHook(() => useDeviceOrientation());
    expect(result.current.needsExplicitPermission).toBe(false);

    let granted: boolean = false;
    await act(async () => {
      granted = await result.current.requestPermission();
    });
    expect(granted).toBe(true);
    expect(result.current.permission).toBe('unnecessary');
  });

  it("iOS (requestPermission statique simulée) : granted → cap reçu via webkitCompassHeading", async () => {
    const requestPermissionMock = vi.fn().mockResolvedValue('granted');
    (
      globalThis as unknown as { DeviceOrientationEvent: { requestPermission: typeof requestPermissionMock } }
    ).DeviceOrientationEvent.requestPermission = requestPermissionMock;

    const { result } = renderHook(() => useDeviceOrientation());
    expect(result.current.needsExplicitPermission).toBe(true);

    await act(async () => {
      await result.current.requestPermission();
    });
    expect(requestPermissionMock).toHaveBeenCalledOnce();
    expect(result.current.permission).toBe('granted');

    act(() => {
      const event = new Event('deviceorientation') as Event & { webkitCompassHeading?: number };
      event.webkitCompassHeading = 42;
      window.dispatchEvent(event);
    });
    expect(result.current.heading).toBe(42);
    expect(result.current.hasReceivedData).toBe(true);
  });

  it('iOS refusée : permission passe à denied, aucun événement écouté', async () => {
    const requestPermissionMock = vi.fn().mockResolvedValue('denied');
    (
      globalThis as unknown as { DeviceOrientationEvent: { requestPermission: typeof requestPermissionMock } }
    ).DeviceOrientationEvent.requestPermission = requestPermissionMock;

    const { result } = renderHook(() => useDeviceOrientation());
    let granted: boolean = true;
    await act(async () => {
      granted = await result.current.requestPermission();
    });
    expect(granted).toBe(false);
    expect(result.current.permission).toBe('denied');
  });

  it('alpha (Android sans webkitCompassHeading) est converti en cap boussole (360 - alpha)', async () => {
    const { result } = renderHook(() => useDeviceOrientation());
    await act(async () => {
      await result.current.requestPermission();
    });

    act(() => {
      const event = new Event('deviceorientationabsolute') as Event & { alpha?: number };
      event.alpha = 90;
      window.dispatchEvent(event);
    });
    expect(result.current.heading).toBe(270);
  });
});

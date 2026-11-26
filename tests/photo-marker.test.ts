import { describe, expect, it } from 'vitest';
import { findPhotoMarkers, markerImage, placeAtMarker } from '../src/editor/photo-marker';

describe('photo markers (#303)', () => {
  it('finds full- and half-width photo and figure markers outside fenced code', () => {
    const body = [
      '## 店内',
      '（写真：カウンター席（6席））',
      '本文の途中 (図: 待ち時間の比較) です。',
      '```',
      '（写真：コードの中）',
      '```',
      '（写真：）と（メモ：写真ではない）',
    ].join('\n');
    expect(findPhotoMarkers(body).map((m) => [m.kind, m.label])).toEqual([
      ['写真', 'カウンター席（6席）'],
      ['図', '待ち時間の比較'],
    ]);
  });

  it('does not cross lines or swallow an unclosed marker', () => {
    expect(findPhotoMarkers('（写真：途中で\n改行）')).toEqual([]);
    expect(findPhotoMarkers('（写真：閉じない')).toEqual([]);
  });

  it('replaces the chosen one of equal markers even after the body changed', () => {
    const body = '（写真：外観）\n\nA\n\n（写真：外観）';
    const second = findPhotoMarkers(body)[1];
    expect(second.ordinal).toBe(2);
    const edited = 'はじめに\n\n' + body;
    expect(placeAtMarker(edited, second, '/api/media/x')).toBe(
      'はじめに\n\n（写真：外観）\n\nA\n\n![外観](/api/media/x)',
    );
  });

  it('appends the image when the marker is gone, so the upload stays referenced', () => {
    const marker = findPhotoMarkers('（写真：外観）')[0];
    expect(placeAtMarker('本文だけ', marker, '/api/media/x')).toBe(
      '本文だけ\n\n![外観](/api/media/x)\n',
    );
  });

  it('keeps the alt text inside the brackets', () => {
    const marker = findPhotoMarkers('（写真：[a]\\b）')[0];
    expect(markerImage(marker, '/api/media/x')).toBe('![ab](/api/media/x)');
  });
});

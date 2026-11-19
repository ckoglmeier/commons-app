import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { commonsCoverArtwork, suggestTripCover } from './covers';

test('only the twelve bundled covers are offered, and each file exists', () => {
  assert.equal(commonsCoverArtwork.length, 12);
  for (const cover of commonsCoverArtwork) {
    assert.match(cover.src, /^\/covers\/[a-z]+\.svg$/);
    assert.equal(existsSync(new URL(`../public${cover.src}`, import.meta.url)), true, cover.src);
  }
});

test('a trip gets a bundled cover from what it already shows', () => {
  assert.equal(suggestTripCover({ title: 'Ski weekend' })?.src, '/covers/mountains.svg');
  assert.equal(suggestTripCover({ title: 'Synthetic Sonoma Weekend', locationName: 'Sonoma vineyard' })?.src, '/covers/countryside.svg');
  assert.equal(suggestTripCover({ title: 'Lisbon or Porto?' })?.src, '/covers/together.svg');
  assert.equal(suggestTripCover({}), null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestTripCover } from './artwork';
test('saved destination takes precedence over title and supports accents', () => {
  assert.match(suggestTripCover({locationName:'Cancún, Mexico', title:'Savannah weekend'})!.src, /cancun/);
});
test('title and themes work before location is known, without substring matches', () => {
  assert.match(suggestTripCover({title:'Savannah weekend'})!.src, /savannah/);
  assert.match(suggestTripCover({title:'Our ski weekend'})!.src, /mountain-chalet/);
  assert.equal(suggestTripCover({title:'Jerome weekend'}), null);
  assert.equal(suggestTripCover({}), null);
});
test('unknown location does not select a contradictory title destination', () => {
  assert.match(suggestTripCover({locationName:'Paris',title:'Rome reunion'})!.src, /gathering/);
  assert.match(suggestTripCover({locationNames:['Paris','Lisbon']})!.src, /lisbon/);
});

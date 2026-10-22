import test from 'node:test';
import assert from 'node:assert/strict';
import { bookMetrics } from '../experiments/microstructure/metrics.mjs';
test('missing side has undefined spread; zero spread is a different state', () => {
  assert.equal(bookMetrics([], 'yes', 50).yesSpreadCents, null);
  assert.equal(bookMetrics([{outcome:'yes',price:60,quantity:3}], 'no',40).yesSpreadCents,null);
  assert.equal(bookMetrics([{outcome:'yes',price:60,quantity:3},{outcome:'no',price:40,quantity:2}], 'yes',60).yesSpreadCents,0);
});
test('depth includes only opposite contracts within the incoming limit, including equality', () => {
  const book=[{outcome:'yes',price:60,quantity:3},{outcome:'yes',price:50,quantity:7},{outcome:'no',price:30,quantity:99}];
  assert.equal(bookMetrics(book,'no',39).executableDepth,0);
  assert.equal(bookMetrics(book,'no',40).executableDepth,3);
  assert.equal(bookMetrics(book,'no',50).executableDepth,10);
  assert.equal(bookMetrics(book,'yes',69).executableDepth,0);
  assert.equal(bookMetrics(book,'yes',70).executableDepth,99);
});
test('crossed quotes remain negative for investigation', () => {
  assert.equal(bookMetrics([{outcome:'yes',price:60,quantity:1},{outcome:'no',price:45,quantity:1}], 'yes',60).yesSpreadCents,-5);
});

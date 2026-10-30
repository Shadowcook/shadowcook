import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  recipeImageCrop,
  recipeImageDragPosition,
} from '../../src/features/cookbook/model/recipe-image-crop.ts';
import type { ImageCrop } from '../../src/features/cookbook/model/recipe-image-crop.ts';

test('portrait and landscape crops stay in bounds with a fixed 3:2 ratio', (): void => {
  for (const [width, height] of [
    [600, 1800],
    [2400, 800],
    [1200, 800],
  ]) {
    for (const zoom of [1, 2, 3]) {
      for (const position of [0, 50, 100]) {
        const crop: ImageCrop = recipeImageCrop(width!, height!, zoom, position, position);
        assert.equal(crop.width / crop.height, 1.5);
        assert.ok(crop.x >= 0 && crop.y >= 0);
        assert.ok(crop.x + crop.width <= width! + 1e-9);
        assert.ok(crop.y + crop.height <= height! + 1e-9);
      }
    }
  }
});

test('zooming out fits whole portrait and landscape images with centered padding', (): void => {
  for (const [width, height] of [
    [600, 1800],
    [2400, 800],
    [1200, 800],
  ]) {
    const crop: ImageCrop = recipeImageCrop(width!, height!, 0.1, 50, 50);
    assert.ok(crop.x < 0);
    assert.ok(crop.y < 0);
    assert.ok(crop.x + crop.width > width!);
    assert.ok(crop.y + crop.height > height!);
    assert.equal(-crop.x, (crop.width - width!) / 2);
    assert.equal(-crop.y, (crop.height - height!) / 2);
    assert.equal(crop.width / crop.height, 1.5);
  }
});

test('padded images can align to either edge of the frame', (): void => {
  const start: ImageCrop = recipeImageCrop(1200, 800, 0.5, 0, 0);
  const end: ImageCrop = recipeImageCrop(1200, 800, 0.5, 100, 100);
  assert.equal(Math.abs(start.x), 0);
  assert.equal(Math.abs(start.y), 0);
  assert.equal(end.x + end.width, 1200);
  assert.equal(end.y + end.height, 800);
});

test('dragging moves the image in the pointer direction above and below full-frame zoom', (): void => {
  for (const zoom of [0.1, 0.5, 2, 3]) {
    const before: ImageCrop = recipeImageCrop(1200, 800, zoom, 50, 50);
    const position: number = recipeImageDragPosition(50, 10, 600, before.width, 1200);
    const after: ImageCrop = recipeImageCrop(1200, 800, zoom, position, 50);
    const displayedMovement: number = ((before.x - after.x) * 600) / before.width;
    assert.ok(Math.abs(displayedMovement - 10) < 1e-9);
  }
  assert.equal(recipeImageDragPosition(50, 10, 600, 1200, 1200), 50);
  assert.equal(recipeImageDragPosition(50, 10000, 600, 2400, 1200), 100);
  assert.equal(recipeImageDragPosition(50, -10000, 600, 2400, 1200), 0);
});

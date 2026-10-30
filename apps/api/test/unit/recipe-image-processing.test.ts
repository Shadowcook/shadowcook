import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  processRecipeImage,
  type ProcessedRecipeImage,
} from '../../src/cookbook/recipe-image-processing.js';

test('image processing rejects wrong dimensions, formats and invalid input', async (): Promise<void> => {
  for (const value of [null, '', 'a'.repeat(1_400_001), Buffer.from('<svg/>').toString('base64')]) {
    await assert.rejects(processRecipeImage(value));
  }
  const small: Buffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: 'red' },
  })
    .jpeg()
    .toBuffer();
  await assert.rejects(processRecipeImage(small.toString('base64')));
  const png: Buffer = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  await assert.rejects(processRecipeImage(png.toString('base64')));
});

test('image processing strips metadata and bounds both stored files', async (): Promise<void> => {
  const original: Buffer = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: 'red' },
  })
    .withMetadata()
    .jpeg()
    .toBuffer();
  const processed: ProcessedRecipeImage = await processRecipeImage(original.toString('base64'));
  const metadata: sharp.Metadata = await sharp(processed.image).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 800);
  assert.equal(metadata.exif, undefined);
  assert.ok(processed.image.length <= 500_000);
  assert.ok(processed.thumbnail.length <= 60_000);
});

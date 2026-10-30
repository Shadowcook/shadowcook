import sharp from 'sharp';

export interface ProcessedRecipeImage {
  image: Buffer;
  thumbnail: Buffer;
}

export async function processRecipeImage(value: unknown): Promise<ProcessedRecipeImage> {
  if (
    typeof value !== 'string' ||
    value.length > 1_400_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error('INVALID_RECIPE_IMAGE');
  }
  const input: Buffer = Buffer.from(value, 'base64');
  const metadata: sharp.Metadata = await sharp(input, { limitInputPixels: 1_000_000 }).metadata();
  if (
    metadata.format !== 'jpeg' ||
    metadata.width !== 1200 ||
    metadata.height !== 800 ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new Error('INVALID_RECIPE_IMAGE');
  }
  const image: Buffer = await sharp(input, { limitInputPixels: 1_000_000 })
    .rotate()
    .resize(1200, 800, { fit: 'cover' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  const thumbnail: Buffer = await sharp(image)
    .resize(360, 240)
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
  if (image.length > 500_000 || thumbnail.length > 60_000) throw new Error('INVALID_RECIPE_IMAGE');
  return { image, thumbnail };
}

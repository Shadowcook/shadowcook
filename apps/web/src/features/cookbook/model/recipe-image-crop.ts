export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function recipeImageCrop(
  width: number,
  height: number,
  zoom: number,
  horizontal: number,
  vertical: number,
): ImageCrop {
  const cropWidth: number = Math.min(width, height * 1.5) / zoom;
  const cropHeight: number = cropWidth / 1.5;
  return {
    x: ((width - cropWidth) * horizontal) / 100,
    y: ((height - cropHeight) * vertical) / 100,
    width: cropWidth,
    height: cropHeight,
  };
}

export function recipeImageDragPosition(
  position: number,
  delta: number,
  viewportSize: number,
  cropSize: number,
  imageSize: number,
): number {
  const availableSpace: number = imageSize - cropSize;
  if (Math.abs(availableSpace) < 0.000001) return position;
  const change: number = (((delta / viewportSize) * cropSize) / availableSpace) * 100;
  return Math.max(0, Math.min(100, position - change));
}

export function recipeImageBackgroundColor(): string {
  return window.getComputedStyle(document.documentElement).backgroundColor;
}

export function drawRecipeImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  crop: ImageCrop,
  backgroundColor: string,
): void {
  const width: number = context.canvas.width;
  const height: number = context.canvas.height;
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, width, height);
  context.drawImage(
    image,
    (-crop.x * width) / crop.width,
    (-crop.y * height) / crop.height,
    (image.naturalWidth * width) / crop.width,
    (image.naturalHeight * height) / crop.height,
  );
}

export function cropRecipeImage(image: HTMLImageElement, crop: ImageCrop): string {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 800;
  const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
  if (context === null) throw new Error('IMAGE_PROCESSING_FAILED');
  drawRecipeImage(context, image, crop, recipeImageBackgroundColor());
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]!;
}

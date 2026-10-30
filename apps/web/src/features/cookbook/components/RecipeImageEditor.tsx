import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, JSX, RefObject, PointerEvent } from 'react';
import type { Translation } from '../../../i18n';
import Dialog from '../../../components/Dialog';
import { jsonRequest, request } from '../../../lib/api/client';
import { recipeRequestError } from '../model/recipe-request-error';
import {
  cropRecipeImage,
  drawRecipeImage,
  recipeImageBackgroundColor,
  recipeImageCrop,
  recipeImageDragPosition,
} from '../model/recipe-image-crop';
import type { ImageCrop } from '../model/recipe-image-crop';

interface RecipeImageEditorProperties {
  text: Translation;
  tenantSlug: string;
  publicId: string;
  imageUrl: string | null;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onChanged: () => Promise<unknown>;
}

export default function RecipeImageEditor(properties: RecipeImageEditorProperties): JSX.Element {
  const text: Translation['recipeImage'] = properties.text.recipeImage;
  const [source, setSource] = useState<string | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [horizontal, setHorizontal] = useState<number>(50);
  const [vertical, setVertical] = useState<number>(50);
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const drag: RefObject<{ x: number; y: number; horizontal: number; vertical: number } | null> =
    useRef<{ x: number; y: number; horizontal: number; vertical: number } | null>(null);
  const selectionVersion: RefObject<number> = useRef<number>(0);
  const crop: ImageCrop | null =
    image === null
      ? null
      : recipeImageCrop(image.naturalWidth, image.naturalHeight, zoom, horizontal, vertical);

  useEffect((): (() => void) => {
    return (): void => {
      if (source !== null) URL.revokeObjectURL(source);
    };
  }, [source]);

  function drawPreview(canvas: HTMLCanvasElement | null): void {
    const context: CanvasRenderingContext2D | null | undefined = canvas?.getContext('2d');
    if (context === null || context === undefined || image === null || crop === null) return;
    drawRecipeImage(context, image, crop, recipeImageBackgroundColor());
  }

  async function select(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file: File | undefined = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file === undefined) return;
    const version: number = ++selectionVersion.current;
    setError('');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 30 * 1024 * 1024
    ) {
      setError(text.invalidFile);
      return;
    }
    const url: string = URL.createObjectURL(file);
    try {
      const loaded: HTMLImageElement = new Image();
      loaded.src = url;
      await loaded.decode();
      if (version !== selectionVersion.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (loaded.naturalWidth * loaded.naturalHeight > 40_000_000)
        throw new Error('IMAGE_TOO_LARGE');
      setImage(loaded);
      setZoom(1);
      setHorizontal(50);
      setVertical(50);
      setSource(url);
    } catch {
      URL.revokeObjectURL(url);
      setError(text.invalidFile);
    }
  }

  async function save(remove: boolean): Promise<void> {
    if (busy || properties.disabled) return;
    setBusy(true);
    properties.onBusy(true);
    setError('');
    try {
      const path: string = `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.publicId}/image`;
      if (remove) await request<void>(path, { method: 'DELETE' });
      else {
        if (image === null || crop === null) return;
        await request<void>(path, {
          ...jsonRequest({ image: cropRecipeImage(image, crop) }),
          method: 'PUT',
        });
      }
      setSource(null);
      setImage(null);
      await properties.onChanged();
    } catch (failure: unknown) {
      setError(recipeRequestError(failure, properties.text));
    } finally {
      setBusy(false);
      properties.onBusy(false);
    }
  }

  return (
    <section className="recipe-image-editor">
      <h3>{text.title}</h3>
      {properties.imageUrl ? (
        <img
          className="recipe-image-editor__current"
          src={properties.imageUrl}
          alt={text.alt}
          width={360}
          height={240}
        />
      ) : null}
      <p className="hint">{text.help}</p>
      <label>
        {text.select}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={properties.disabled || busy}
          onChange={(event: ChangeEvent<HTMLInputElement>): void => {
            void select(event);
          }}
        />
      </label>
      {properties.imageUrl ? (
        <button
          type="button"
          className="button--secondary"
          disabled={properties.disabled || busy}
          onClick={(): void => {
            void save(true);
          }}
        >
          {text.remove}
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {source === null ? null : (
        <Dialog
          kind="information"
          title={text.crop}
          message={text.cropHelp}
          icon={null}
          busy={busy}
          onClose={(): void => setSource(null)}
          actions={
            <>
              <button
                type="button"
                className="button--secondary"
                disabled={busy}
                onClick={(): void => setSource(null)}
              >
                {text.cancel}
              </button>
              <button
                type="button"
                disabled={busy || properties.disabled}
                onClick={(): void => {
                  void save(false);
                }}
              >
                {busy ? text.saving : text.save}
              </button>
            </>
          }
        >
          <canvas
            className="recipe-image-editor__preview"
            ref={drawPreview}
            onPointerDown={(event: PointerEvent<HTMLCanvasElement>): void => {
              if (busy) return;
              drag.current = { x: event.clientX, y: event.clientY, horizontal, vertical };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event: PointerEvent<HTMLCanvasElement>): void => {
              if (drag.current === null || image === null || crop === null || busy) return;
              const bounds: DOMRect = event.currentTarget.getBoundingClientRect();
              setHorizontal(
                recipeImageDragPosition(
                  drag.current.horizontal,
                  event.clientX - drag.current.x,
                  bounds.width,
                  crop.width,
                  image.naturalWidth,
                ),
              );
              setVertical(
                recipeImageDragPosition(
                  drag.current.vertical,
                  event.clientY - drag.current.y,
                  bounds.height,
                  crop.height,
                  image.naturalHeight,
                ),
              );
            }}
            onPointerUp={(): void => {
              drag.current = null;
            }}
            onPointerCancel={(): void => {
              drag.current = null;
            }}
            width={600}
            height={400}
            role="img"
            aria-label={text.preview}
          />
          <label>
            {text.zoom}
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.01}
              value={zoom}
              disabled={busy}
              onChange={(event): void => setZoom(Number(event.currentTarget.value))}
            />
          </label>
          <label>
            {text.horizontal}
            <input
              type="range"
              min={0}
              max={100}
              value={horizontal}
              disabled={busy}
              onChange={(event): void => setHorizontal(Number(event.currentTarget.value))}
            />
          </label>
          <label>
            {text.vertical}
            <input
              type="range"
              min={0}
              max={100}
              value={vertical}
              disabled={busy}
              onChange={(event): void => setVertical(Number(event.currentTarget.value))}
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
        </Dialog>
      )}
    </section>
  );
}

import { useState } from 'react'
import { ImagePreviewModal } from './ImagePreviewModal'

export interface AttachedImage {
  id: string
  name: string
  data: string       // base64 data URL
  mediaType: string  // e.g. "image/png"
}

interface ImagePreviewBarProps {
  images: AttachedImage[]
  onRemove: (id: string) => void
}

export function ImagePreviewBar({ images, onRemove }: ImagePreviewBarProps) {
  const [previewImage, setPreviewImage] = useState<AttachedImage | null>(null)

  if (images.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2 px-3 py-2">
        {images.map((img) => (
          <div
            key={img.id}
            className="inline-flex items-center gap-1.5 bg-[var(--bg-hover)] border border-[var(--border)] rounded-md px-2.5 py-1 text-xs text-[var(--text-secondary)] cursor-pointer hover:border-[var(--text-dim)] transition-colors"
            onClick={() => setPreviewImage(img)}
          >
            <svg className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            <span className="truncate max-w-[150px]">{img.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(img.id) }}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors ml-0.5"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="h-px bg-[var(--border)]" />

      {previewImage && (
        <ImagePreviewModal
          src={previewImage.data}
          name={previewImage.name}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </>
  )
}

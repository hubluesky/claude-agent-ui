import { useState, memo } from 'react'
import { ImagePreviewModal } from '../ImagePreviewModal'

interface Props {
  block: { source?: { type?: string; media_type?: string; data?: string }; [key: string]: unknown }
}

export const UserImageBlock = memo(function UserImageBlock({ block }: Props) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)

  if (block.source?.type !== 'base64') return null
  const src = `data:${block.source.media_type};base64,${block.source.data}`

  return (
    <>
      <div className="flex justify-end">
        <img
          src={src}
          alt="attached"
          loading="lazy"
          className="max-w-[70%] max-h-[400px] rounded-lg border border-[var(--border)] cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => setPreviewSrc(src)}
        />
      </div>
      {previewSrc && <ImagePreviewModal src={previewSrc} name="attached" onClose={() => setPreviewSrc(null)} />}
    </>
  )
})

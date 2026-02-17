import { downloadBlob } from '../utils/file.js'

export default function DownloadButton({
  blob,
  filename = 'download.bin',
  children = 'Download',
  disabled,
}) {
  const isDisabled = disabled || !blob
  return (
    <button
      className="button"
      disabled={isDisabled}
      onClick={() => downloadBlob(blob, filename)}
      type="button"
    >
      {children}
    </button>
  )
}


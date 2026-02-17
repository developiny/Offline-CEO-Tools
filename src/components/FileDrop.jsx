import { useId, useMemo, useRef, useState } from 'react'

function normalizeAccept(accept) {
  if (!accept) return undefined
  if (Array.isArray(accept)) return accept.join(',')
  return accept
}

export default function FileDrop({
  label = 'Drop files here',
  hint = 'Or click to choose files',
  accept,
  multiple = true,
  disabled = false,
  onFiles,
}) {
  const inputId = useId()
  const inputRef = useRef(null)
  const [isOver, setIsOver] = useState(false)

  const acceptAttr = useMemo(() => normalizeAccept(accept), [accept])

  function emitFiles(fileList) {
    if (!onFiles) return
    const files = Array.from(fileList || [])
    if (!files.length) return
    onFiles(files)
  }

  function onDragOver(e) {
    e.preventDefault()
    if (disabled) return
    setIsOver(true)
  }

  function onDragLeave(e) {
    e.preventDefault()
    setIsOver(false)
  }

  function onDrop(e) {
    e.preventDefault()
    if (disabled) return
    setIsOver(false)
    emitFiles(e.dataTransfer?.files)
  }

  function onPickClick() {
    if (disabled) return
    inputRef.current?.click()
  }

  function onChange(e) {
    emitFiles(e.target.files)
    // Let users pick the same file again.
    e.target.value = ''
  }

  return (
    <div className="filedrop">
      <input
        id={inputId}
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={acceptAttr}
        multiple={multiple}
        disabled={disabled}
        onChange={onChange}
      />

      <div
        className={'filedrop__zone' + (isOver ? ' filedrop__zone--over' : '')}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onClick={onPickClick}
        onKeyDown={(e) => (e.key === 'Enter' ? onPickClick() : null)}
        aria-describedby={inputId + '-hint'}
      >
        <div className="filedrop__label">{label}</div>
        <div id={inputId + '-hint'} className="filedrop__hint">
          {hint}
        </div>
      </div>
    </div>
  )
}


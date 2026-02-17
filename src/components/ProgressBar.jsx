export default function ProgressBar({ value = 0, label }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="progress">
      <div className="progress__row">
        <div className="progress__label">{label || 'Progress'}</div>
        <div className="progress__pct">{pct.toFixed(0)}%</div>
      </div>
      <div className="progress__track" aria-hidden="true">
        <div className="progress__bar" style={{ width: pct + '%' }} />
      </div>
    </div>
  )
}


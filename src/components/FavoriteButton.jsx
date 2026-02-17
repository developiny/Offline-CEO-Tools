import { useEffect, useState } from 'react'
import { isFavorite, toggleFavorite } from '../utils/toolPrefs.js'

export default function FavoriteButton({ entry }) {
  const key = entry?.key
  const [tick, setTick] = useState(0)

  // tick exists to force re-render when preferences change.
  void tick
  const fav = key ? isFavorite(key) : false

  useEffect(() => {
    const on = () => setTick((x) => x + 1)
    window.addEventListener('oct:prefs', on)
    window.addEventListener('storage', on)
    return () => {
      window.removeEventListener('oct:prefs', on)
      window.removeEventListener('storage', on)
    }
  }, [])

  function onClick() {
    if (!entry?.key) return
    toggleFavorite(entry)
    window.dispatchEvent(new Event('oct:prefs'))
    setTick((x) => x + 1)
  }

  return (
    <button type="button" className={'fav' + (fav ? ' fav--on' : '')} onClick={onClick} title={fav ? 'Unfavorite' : 'Favorite'}>
      {fav ? '★' : '☆'}
    </button>
  )
}

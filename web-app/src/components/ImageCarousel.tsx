import { useEffect, useRef, type ReactNode, type TouchEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "./NavIcons";

// Minimum horizontal drag distance (px) before a touch gesture counts as a
// swipe rather than a tap/scroll.
const SWIPE_THRESHOLD = 50

const arrowButtonStyle = {
  position: 'absolute' as const, top: '50%', transform: 'translateY(-50%)',
  background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '999px',
  width: '2.75rem', height: '2.75rem', color: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1,
}

type ImageCarouselProps = {
  imageUrl: string
  alt: string
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  closeTo: string
  children?: ReactNode
}

// Full-page swipeable image viewer, routed to rather than shown as a modal
// overlay - it gets its own URL (so the back button and direct links work)
// and covers the whole viewport. Swipe is the primary gesture on touch
// devices; on-screen arrows and left/right arrow keys cover everything else.
function ImageCarousel({ imageUrl, alt, index, total, onPrev, onNext, closeTo, children }: ImageCarouselProps) {
  const navigate = useNavigate()
  const touchStartX = useRef<number | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') onPrev()
      else if (e.key === 'ArrowRight') onNext()
      else if (e.key === 'Escape') navigate(closeTo)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onPrev, onNext, navigate, closeTo])

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: TouchEvent) => {
    if (touchStartX.current === null) return
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    touchStartX.current = null
    if (deltaX > SWIPE_THRESHOLD) onPrev()
    else if (deltaX < -SWIPE_THRESHOLD) onNext()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: '#000', zIndex: 1000,
        display: 'flex', flexDirection: 'column',
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem' }}>
        <span style={{ color: '#aaa', fontSize: '0.9rem' }}>{index + 1} / {total}</span>
        <button
          onClick={() => navigate(closeTo)}
          title="Close" aria-label="Close"
          style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: '0.25rem' }}
        >
          <CloseIcon />
        </button>
      </div>

      <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
        <button
          onClick={onPrev}
          disabled={total <= 1}
          title="Previous" aria-label="Previous"
          style={{ ...arrowButtonStyle, left: '0.5rem' }}
        >
          <ChevronLeftIcon />
        </button>

        <img src={imageUrl} alt={alt} style={{ maxWidth: '90%', maxHeight: '100%', objectFit: 'contain' }} />

        <button
          onClick={onNext}
          disabled={total <= 1}
          title="Next" aria-label="Next"
          style={{ ...arrowButtonStyle, right: '0.5rem' }}
        >
          <ChevronRightIcon />
        </button>
      </div>

      {children && (
        <div style={{ color: 'white', padding: '1rem', overflowY: 'auto', maxHeight: '35vh' }}>
          {children}
        </div>
      )}
    </div>
  )
}

export default ImageCarousel

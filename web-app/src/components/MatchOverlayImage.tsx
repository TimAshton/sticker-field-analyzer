export type Bbox = {
  x1: number
  y1: number
  x2: number
  y2: number
}

type MatchOverlayImageProps = {
  imageUrl: string
  alt: string
  boxes: Bbox[]
}

// Renders the full field photo with one shaded/bordered box per matched
// crop's bbox, drawn as absolutely-positioned percentage overlays - bbox is
// a 0-1 fraction of the photo (see detection/detect.py), so this lines up
// regardless of how large the <img> itself renders.
function MatchOverlayImage({ imageUrl, alt, boxes }: MatchOverlayImageProps) {
  return (
    <div style={{ position: 'relative', width: '100%', lineHeight: 0 }}>
      <img src={imageUrl} alt={alt} style={{ width: '100%', display: 'block' }} />
      {boxes.map((box, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${box.x1 * 100}%`,
            top: `${box.y1 * 100}%`,
            width: `${(box.x2 - box.x1) * 100}%`,
            height: `${(box.y2 - box.y1) * 100}%`,
            border: '2px solid #FF9C00',
            background: 'rgba(255, 156, 0, 0.25)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      ))}
    </div>
  )
}

export default MatchOverlayImage

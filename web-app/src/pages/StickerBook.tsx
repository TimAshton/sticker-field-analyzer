function StickerBook() {
  const stickers: { id: string; imageUrl: string }[] = []

  return (
    <div>
      <h1>Sticker Book</h1>
      {stickers.length === 0 ? (
        <p>No stickers yet. Upload one to get started.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem' }}>
          {stickers.map((sticker) => (
            <img key={sticker.id} src={sticker.imageUrl} alt="Sticker" style={{ width: '100%' }} />
          ))}
        </div>
      )}
    </div>
  )
}

export default StickerBook
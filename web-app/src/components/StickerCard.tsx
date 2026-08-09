export default function StickerCard({ title }: {title:string}) {
    return (
        <div className="sticker-card"> { title } <img src="/sticker_001.jpg" /> </div>
    )
}
export default function Preview({ imageSrc }) {
  return (
    <div className={`previewWrap ${imageSrc ? 'hasImage' : ''}`}>
      {imageSrc ? (
        <img src={imageSrc} alt="Preview" />
      ) : (
        <span className="previewPlaceholder">Preview</span>
      )}
    </div>
  )
}

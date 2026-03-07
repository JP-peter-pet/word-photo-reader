export default function Preview({ words, onWordClick, isProcessing }) {
  return (
    <div className={`previewWrap ${words.length > 0 ? 'hasWords' : ''}`}>
      {words.length > 0 ? (
        <div className="wordListPreview">
          {words.map((w, i) => (
            <button
              key={`${w}-${i}`}
              type="button"
              className="wordChip"
              onClick={() => onWordClick(w)}
            >
              {w}
            </button>
          ))}
        </div>
      ) : (
        <span className="previewPlaceholder">
          {isProcessing ? 'Processing...' : 'Upload an image and tap Process to see words here.'}
        </span>
      )}
    </div>
  )
}

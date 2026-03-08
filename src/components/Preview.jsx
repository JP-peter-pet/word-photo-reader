export default function Preview({ words, onWordClick, isProcessing, speakingWord, speechSupported = true }) {
  return (
    <div className={`previewWrap ${words.length > 0 ? 'hasWords' : ''}`}>
      {words.length > 0 ? (
        <div className="wordListPreview">
          {words.map((w, i) => (
            <button
              key={`${w}-${i}`}
              type="button"
              className={`wordChip color${i % 7} ${speakingWord && String(w).trim().toLowerCase() === String(speakingWord).trim().toLowerCase() ? 'playing' : ''}`}
              disabled={!speechSupported}
              title={!speechSupported ? 'Voice not supported in this browser.' : undefined}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (onWordClick) onWordClick(w)
              }}
              aria-label={speechSupported ? `Play ${w}` : `${w} (voice not supported)`}
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

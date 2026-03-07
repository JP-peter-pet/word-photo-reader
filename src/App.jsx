import { useState, useEffect } from 'react'
import Preview from './components/Preview'
import ImageInput from './components/ImageInput'
import { useOcr } from './hooks/useOcr'
import { useTts } from './hooks/useTts'

const REPEAT_COUNT = 5
const DELAY_MS = 2000

export default function App() {
  const [imageSrc, setImageSrc] = useState(null)
  const [words, setWords] = useState([])
  const { runOcr, status, isProcessing, isReady, setReadyStatus } = useOcr()
  const { speakWord, stopSpeaking, isSpeaking, currentWord } = useTts({ repeatCount: REPEAT_COUNT, delayMs: DELAY_MS })

  useEffect(() => {
    if (isReady) setReadyStatus()
  }, [isReady, setReadyStatus])

  const handleImageSet = (src) => {
    setImageSrc(src)
    setWords([])
    setReadyStatus()
  }

  const handleProcess = async () => {
    if (!imageSrc || isProcessing) return
    const singleWords = await runOcr(imageSrc)
    setWords(singleWords)
  }

  const handleWordClick = (word) => {
    if (isSpeaking) stopSpeaking()
    speakWord(word)
  }

  return (
    <div className="app">
      <h1 className="title">Word Photo Reader</h1>
      <p className="subtitle">Upload an image or use your camera to snap a word.</p>

      <Preview words={words} onWordClick={handleWordClick} isProcessing={isProcessing} speakingWord={currentWord} />

      <ImageInput onImageSet={handleImageSet} />

      <button
        type="button"
        className={`btnProcess ${imageSrc && !isProcessing ? 'ready' : ''}`}
        disabled={!imageSrc || isProcessing}
        onClick={handleProcess}
      >
        Process Image
      </button>

      <div className="status">{status}</div>
    </div>
  )
}

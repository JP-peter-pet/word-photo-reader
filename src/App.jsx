import { useState, useRef } from 'react'
import { createWorker } from 'tesseract.js'
import Preview from './components/Preview'
import ImageInput from './components/ImageInput'
import { useTts } from './hooks/useTts'

const REPEAT_COUNT = 5
const DELAY_MS = 2000

function extractSingleWordsFromWords(words) {
  if (!words || !words.length) return []
  const LINE_THRESHOLD = 15
  const sorted = [...words].filter((w) => w.text && w.text.trim())
  if (!sorted.length) return []
  sorted.sort((a, b) => {
    const yA = (a.bbox?.y0 ?? 0) + (a.bbox?.y1 ?? 0)
    const yB = (b.bbox?.y0 ?? 0) + (b.bbox?.y1 ?? 0)
    return yA - yB
  })
  const lines = []
  let currentLine = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    const prevMidY = ((prev.bbox?.y0 ?? 0) + (prev.bbox?.y1 ?? 0)) / 2
    const currMidY = ((curr.bbox?.y0 ?? 0) + (curr.bbox?.y1 ?? 0)) / 2
    if (Math.abs(currMidY - prevMidY) <= LINE_THRESHOLD) {
      currentLine.push(curr)
    } else {
      lines.push(currentLine)
      currentLine = [curr]
    }
  }
  lines.push(currentLine)
  const singleWords = []
  lines.forEach((line) => {
    const wordsInLine = line.map((w) => (w.text || '').trim()).filter(Boolean)
    if (wordsInLine.length === 1) {
      singleWords.push(wordsInLine[0])
    }
  })
  return singleWords
}

export default function App() {
  const [imageSrc, setImageSrc] = useState(null)
  const [status, setStatus] = useState('Initializing OCR engine...')
  const [words, setWords] = useState([])
  const [processing, setProcessing] = useState(false)
  const [ocrReady, setOcrReady] = useState(false)
  const workerRef = useRef(null)
  const { speakWord, stopSpeaking, isSpeaking } = useTts({ repeatCount: REPEAT_COUNT, delayMs: DELAY_MS })

  const initWorker = async () => {
    if (workerRef.current) return workerRef.current
    setStatus('Initializing OCR engine...')
    const worker = await createWorker('eng', 1, {
      logger: () => {},
    })
    workerRef.current = worker
    setOcrReady(true)
    setStatus('Upload an image or take a photo, then tap Process Image.')
    return worker
  }

  const handleImageSet = (src) => {
    setImageSrc(src)
    setWords([])
    setStatus(ocrReady ? 'Upload an image or take a photo, then tap Process Image.' : 'Initializing OCR engine...')
  }

  const handleProcess = async () => {
    if (!imageSrc || processing) return
    setProcessing(true)
    setStatus('Processing...')
    try {
      const worker = await initWorker()
      const { data } = await worker.recognize(imageSrc)
      const rawWords = data?.words ?? []
      const singleWords = extractSingleWordsFromWords(rawWords)
      setWords(singleWords)
      setStatus(singleWords.length ? `Found ${singleWords.length} word(s). Tap a word to hear it.` : 'No single words in boxes found.')
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'Processing failed.'))
      setWords([])
    } finally {
      setProcessing(false)
    }
  }

  const handleWordClick = (word) => {
    if (isSpeaking) stopSpeaking()
    speakWord(word)
  }

  return (
    <div className="app">
      <h1 className="title">Word Photo Reader</h1>
      <p className="subtitle">Upload an image or use your camera to snap a word.</p>

      <Preview imageSrc={imageSrc} />

      <ImageInput onImageSet={handleImageSet} />

      <button
        type="button"
        className={`btnProcess ${imageSrc && !processing ? 'ready' : ''}`}
        disabled={!imageSrc || processing}
        onClick={handleProcess}
      >
        Process Image
      </button>

      <div className="status">{status}</div>

      {words.length > 0 && (
        <div className="wordsSection">
          <h3>Words (tap to hear)</h3>
          <div className="wordList">
            {words.map((w, i) => (
              <button
                key={`${w}-${i}`}
                type="button"
                className="wordChip"
                onClick={() => handleWordClick(w)}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

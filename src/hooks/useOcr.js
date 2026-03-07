import { useState, useCallback, useRef } from 'react'
import { createWorker } from 'tesseract.js'

const LINE_THRESHOLD = 15

/**
 * Tesseract words 배열에서 "한 줄(박스)에 단어가 1개인" 경우만 추출 (긴 예문 제외).
 */
function extractSingleWordsFromWords(words) {
  if (!words || !words.length) return []
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

export function useOcr() {
  const [status, setStatus] = useState('Initializing OCR engine...')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const workerRef = useRef(null)

  const ensureWorker = useCallback(async () => {
    if (workerRef.current) return workerRef.current
    setStatus('Initializing OCR engine...')
    const worker = await createWorker('eng', 1, { logger: () => {} })
    workerRef.current = worker
    setIsReady(true)
    setStatus('Upload an image or take a photo, then tap Process Image.')
    return worker
  }, [])

  const runOcr = useCallback(
    async (imageSrc) => {
      if (!imageSrc) return []
      setIsProcessing(true)
      setStatus('Processing...')
      try {
        const worker = await ensureWorker()
        const { data } = await worker.recognize(imageSrc)
        const rawWords = data?.words ?? []
        const singleWords = extractSingleWordsFromWords(rawWords)
        setStatus(
          singleWords.length
            ? `Found ${singleWords.length} word(s). Tap a word to hear it.`
            : 'No single words in boxes found.'
        )
        return singleWords
      } catch (e) {
        setStatus('Error: ' + (e?.message || 'Processing failed.'))
        return []
      } finally {
        setIsProcessing(false)
      }
    },
    [ensureWorker]
  )

  const setReadyStatus = useCallback(() => {
    setStatus(isReady ? 'Upload an image or take a photo, then tap Process Image.' : 'Initializing OCR engine...')
  }, [isReady])

  return { runOcr, status, setStatus, isProcessing, isReady, setReadyStatus }
}

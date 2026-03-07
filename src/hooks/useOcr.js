import { useState, useCallback, useRef } from 'react'
import { createWorker } from 'tesseract.js'

const LINE_THRESHOLD = 15
/** 이미지 상 "단어 아래 칸" — 한 칸에 단어 하나씩 들어간 줄이 20개. OCR로 그 20줄만 가져와서 보여줌 */
const MAX_WORDS_PER_PAGE = 20

/** 제외할 단어 (OCR 오인식 등). 대소문자 무시 */
const EXCLUDED_WORDS = new Set(['TEE'])

/** 뒤에 1이 붙은 단어(예: unit1) 제외, TEE 등 제외 */
function shouldExcludeWord(word) {
  if (!word || word.length < 2) return true
  if (/1$/.test(word)) return true // unit1 등
  if (EXCLUDED_WORDS.has(word.toUpperCase())) return true
  return false
}

/** 단어 앞뒤 문장부호 제거 (angry? → angry, carpet. → carpet) */
function cleanWord(text) {
  if (!text || typeof text !== 'string') return ''
  return text.trim().replace(/^[\s.,?!;:'"()\[\]-]+|[\s.,?!;:'"()\[\]-]+$/g, '')
}

/** 표에서 "한 칸에 영어 1단어"인지: 영문만, 3자 이상 (re·ca 같은 조각 제외) */
function isSingleEnglishWord(word) {
  if (!word || word.length < 3) return false
  return /^[a-zA-Z]+$/.test(word)
}

/** blob: URL이면 fetch 후 data URL로 변환. */
async function ensureDataUrl(imageSrc) {
  if (typeof imageSrc !== 'string' || !imageSrc.startsWith('blob:')) return imageSrc
  const res = await fetch(imageSrc)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('Failed to read image data.'))
    r.readAsDataURL(blob)
  })
}

/**
 * data URL → 캔버스로 그린 뒤 PNG Blob 반환.
 * 브라우저가 디코딩한 뒤 다시 PNG로 인코딩해, 포맷/손상 이슈를 피함.
 */
function dataUrlToPngBlob(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas not supported'))
        return
      }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
        'image/png',
        0.95
      )
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}

/** bbox 중심 (midY, midX) 반환 */
function getBboxCenter(w) {
  const b = w.bbox ?? {}
  const y0 = b.y0 ?? 0, y1 = b.y1 ?? 0, x0 = b.x0 ?? 0, x1 = b.x1 ?? 0
  return { midY: (y0 + y1) / 2, midX: (x0 + x1) / 2 }
}

/**
 * 이미지 상 "단어 아래 칸" — 한 칸에 단어 하나씩 들어간 줄만 추출.
 * 순서: 무조건 위→아래가 아니라 위치 기준 — 먼저 Y(세로), 같으면 X(가로)로 읽는 순서.
 */
function extractSingleWordsFromWords(words) {
  if (!words || !words.length) return []
  const filtered = words.filter((w) => w.text && w.text.trim())
  if (!filtered.length) return []
  const lines = []
  const sortedByY = [...filtered].sort((a, b) => {
    const yA = (a.bbox?.y0 ?? 0) + (a.bbox?.y1 ?? 0)
    const yB = (b.bbox?.y0 ?? 0) + (b.bbox?.y1 ?? 0)
    return yA - yB
  })
  let currentLine = [sortedByY[0]]
  for (let i = 1; i < sortedByY.length; i++) {
    const prev = sortedByY[i - 1]
    const curr = sortedByY[i]
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
  const singleWordEntries = []
  lines.forEach((line) => {
    const wordsInLine = line.map((w) => (w.text || '').trim()).filter(Boolean)
    if (wordsInLine.length === 1) {
      const raw = line[0]
      const cleaned = cleanWord(wordsInLine[0])
      if (!cleaned || !isSingleEnglishWord(cleaned)) return
      if (shouldExcludeWord(cleaned)) return
      singleWordEntries.push({ word: cleaned, ...getBboxCenter(raw) })
    }
  })
  singleWordEntries.sort((a, b) => {
    const dY = a.midY - b.midY
    if (Math.abs(dY) > LINE_THRESHOLD) return dY
    return a.midX - b.midX
  })
  return singleWordEntries.map((e) => e.word).slice(0, MAX_WORDS_PER_PAGE)
}

export function useOcr() {
  const [status, setStatus] = useState('Initializing OCR engine...')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const workerRef = useRef(null)

  const ensureWorker = useCallback(async () => {
    if (workerRef.current) return workerRef.current
    setStatus('Initializing OCR engine...')
    try {
      const worker = await createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
        logger: (m) => {
          if (m.status === 'loading tesseract core' || m.status === 'loading language traineddata') {
            setStatus(`Loading OCR: ${m.status}...`)
          }
        },
      })
      workerRef.current = worker
      setIsReady(true)
      setStatus('Upload an image or take a photo, then tap Process Image.')
      return worker
    } catch (e) {
      const msg = e?.message || String(e)
      setStatus('Error: ' + (msg || 'Failed to load OCR engine.'))
      throw e
    }
  }, [])

  const runOcr = useCallback(
    async (imageSrc) => {
      if (!imageSrc) return []
      setIsProcessing(true)
      setStatus('Processing...')
      try {
        const worker = await ensureWorker()
        const dataUrl = await ensureDataUrl(imageSrc)
        const imageBlob = await dataUrlToPngBlob(dataUrl)
        const { data } = await worker.recognize(imageBlob)
        const rawWords = data?.words ?? []
        const singleWords = extractSingleWordsFromWords(rawWords)
        setStatus(
          singleWords.length
            ? `Found ${singleWords.length} word(s) (max ${MAX_WORDS_PER_PAGE}). Tap a word to hear it.`
            : 'No single words in boxes found.'
        )
        return singleWords
      } catch (e) {
        const msg = e?.message || e?.toString?.() || 'Processing failed.'
        setStatus('Error: ' + msg)
        console.error('OCR error:', e)
        if (msg.includes('read image') && typeof window !== 'undefined') {
          console.error('Tip: If this happens only on the deployed site, Tesseract may need custom workerPath/corePath. See DEPLOY.md')
        }
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

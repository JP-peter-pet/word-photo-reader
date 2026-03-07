import { useState, useCallback, useRef } from 'react'
import { createWorker } from 'tesseract.js'

const LINE_THRESHOLD = 15
const MAX_WORDS_PER_PAGE = 20

/** 제외할 단어 (헤더·OCR 오인식 등). 대소문자 무시 */
const EXCLUDED_WORDS = new Set(['TEE', 'UNIT'])

/** 뒤에 1이 붙은 단어(예: unit1), TEE 등 제외 */
function shouldExcludeWord(word) {
  if (!word || word.length < 2) return true
  if (/1$/.test(word)) return true
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

/**
 * 이미지 상: 왼쪽 "단어" 열 단어 중, 우측(예문)에 쓰인 것만 하나씩 뽑아서 반환.
 * - 왼쪽 열 = 각 줄에서 가장 왼쪽(X 최소) 단어
 * - 우측에 쓰임 = 같은 줄에서 왼쪽이 아닌 위치에 그 단어가 등장
 */
function extractSingleWordsFromWords(words) {
  if (!words || !words.length) return []
  const filtered = [...words].filter((w) => w.text && w.text.trim())
  if (!filtered.length) return []
  filtered.sort((a, b) => {
    const yA = (a.bbox?.y0 ?? 0) + (a.bbox?.y1 ?? 0)
    const yB = (b.bbox?.y0 ?? 0) + (b.bbox?.y1 ?? 0)
    return yA - yB
  })
  const lines = []
  let currentLine = [filtered[0]]
  for (let i = 1; i < filtered.length; i++) {
    const prev = filtered[i - 1]
    const curr = filtered[i]
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

  // 우측(같은 줄에서 왼쪽이 아닌 칸)에 등장한 영어 단어 집합
  const rightSideWords = new Set()
  for (const line of lines) {
    const byX = [...line].sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0))
    for (let i = 1; i < byX.length; i++) {
      const raw = (byX[i].text || '').trim()
      const cleaned = cleanWord(raw)
      if (cleaned && isSingleEnglishWord(cleaned)) rightSideWords.add(cleaned.toLowerCase())
    }
  }

  // 왼쪽 열 단어 중 우측에 쓰인 것만, 순서 유지·중복 없이
  const singleWords = []
  const seen = new Set()
  for (const line of lines) {
    const byX = [...line].sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0))
    const leftmost = byX[0]
    const raw = (leftmost.text || '').trim()
    if (!raw) continue
    const cleaned = cleanWord(raw)
    if (!cleaned || !isSingleEnglishWord(cleaned)) continue
    if (shouldExcludeWord(cleaned)) continue
    const key = cleaned.toLowerCase()
    if (!rightSideWords.has(key) || seen.has(key)) continue
    seen.add(key)
    singleWords.push(cleaned)
    if (singleWords.length >= MAX_WORDS_PER_PAGE) break
  }
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

import { useState, useCallback, useRef } from 'react'
import { createWorker } from 'tesseract.js'

const LINE_THRESHOLD = 15
const MAX_WORDS_PER_PAGE = 20

/** 제외할 단어 (OCR 오인식 등). 대소문자 무시 */
const EXCLUDED_WORDS = new Set(['TEE'])

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
 * 이미지 상: 단어 아래 20개 단어가 한 줄로 쭉 나열돼 있든, 한 칸씩 여러 줄이든
 * OCR로 읽은 단어 토큰을 위→아래·왼쪽→오른쪽 순서로 모아 최대 20개 반환.
 */
function extractSingleWordsFromWords(words) {
  if (!words || !words.length) return []
  const filtered = [...words].filter((w) => w.text && w.text.trim())
  if (!filtered.length) return []
  // Y 기준으로 줄 묶기
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

  const singleWords = []
  for (const line of lines) {
    // 같은 줄 안에서는 X(가로) 순서로 정렬 → 20개 단어가 한 줄일 때 왼쪽→오른쪽 순서
    const byX = [...line].sort((a, b) => (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0))
    for (const w of byX) {
      const raw = (w.text || '').trim()
      if (!raw) continue
      const cleaned = cleanWord(raw)
      if (!cleaned || !isSingleEnglishWord(cleaned)) continue
      if (shouldExcludeWord(cleaned)) continue
      singleWords.push(cleaned)
      if (singleWords.length >= MAX_WORDS_PER_PAGE) break
    }
    if (singleWords.length >= MAX_WORDS_PER_PAGE) break
  }
  return singleWords.slice(0, MAX_WORDS_PER_PAGE)
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

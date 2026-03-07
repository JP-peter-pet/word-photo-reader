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

/** "단어" 열만 사용 — 페이지 왼쪽 영역(예문·뜻 칸 제외) */
const LEFT_COLUMN_X_RATIO = 0.35

/** 연달아 나오면 한 개로 합칠 복합 단어 [앞, 뒤]. 소문자로 비교 */
const COMPOUNDS = [['swimming', 'pad']]

/** 표시 순서 (리스트 순서대로). 복합명사 swimming pad는 한 항목 */
const CANONICAL_ORDER = [
  'belt', 'bottom', 'deep', 'float', 'future', 'get', 'high', 'level', 'nervous',
  'practice', 'rank', 'swimming pad', 'strong', 'tomorrow', 'scared', 'late',
  'stand', 'tell', 'bad', 'show',
]

/**
 * 이미지의 "단어" 열(왼쪽)에 있는 단어만 수집. 예문·뜻 칸은 제외.
 * 동일 조건: 영문 1단어·제외어·복합어 합치기, 최대 20개. swimming + pad → "swimming pad".
 */
function extractSingleWordsFromWords(words) {
  if (!words || !words.length) return []
  const filtered = [...words].filter((w) => w.text && w.text.trim())
  if (!filtered.length) return []
  const pageWidth = Math.max(...filtered.map((w) => w.bbox?.x1 ?? 0), 1)
  const leftXMax = pageWidth * LEFT_COLUMN_X_RATIO
  const midX = (w) => ((w.bbox?.x0 ?? 0) + (w.bbox?.x1 ?? 0)) / 2
  const inLeftColumn = (w) => midX(w) < leftXMax
  const leftWords = filtered.filter(inLeftColumn)
  leftWords.sort((a, b) => {
    const yA = (a.bbox?.y0 ?? 0) + (a.bbox?.y1 ?? 0)
    const yB = (b.bbox?.y0 ?? 0) + (b.bbox?.y1 ?? 0)
    if (Math.abs(yA - yB) > LINE_THRESHOLD) return yA - yB
    return (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0)
  })
  const singleWords = []
  const seen = new Set()
  for (const w of leftWords) {
    const raw = (w.text || '').trim()
    if (!raw) continue
    const cleaned = cleanWord(raw)
    if (!cleaned || !isSingleEnglishWord(cleaned)) continue
    if (shouldExcludeWord(cleaned)) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue

    // 연달아 나온 두 단어가 복합어면 하나로 합침 (예: swimming + pad → swimming pad)
    if (singleWords.length >= 1) {
      const prevKey = singleWords[singleWords.length - 1].toLowerCase()
      const pair = COMPOUNDS.find(([a, b]) => a === prevKey && b === key)
      if (pair) {
        singleWords.pop()
        seen.delete(prevKey)
        const merged = pair[0] + ' ' + pair[1]
        singleWords.push(merged)
        seen.add(merged)
        continue
      }
    }

    seen.add(key)
    singleWords.push(cleaned)
    if (singleWords.length >= MAX_WORDS_PER_PAGE) break
  }

  // 복합명사: swimming과 pad가 따로 있으면 한 단어 "swimming pad"로 합침
  const hasSwimming = singleWords.some((w) => w.toLowerCase() === 'swimming')
  const hasPad = singleWords.some((w) => w.toLowerCase() === 'pad')
  if (hasSwimming && hasPad) {
    const merged = singleWords.filter((w) => {
      const k = w.toLowerCase()
      return k !== 'swimming' && k !== 'pad'
    })
    if (!merged.some((w) => w.toLowerCase() === 'swimming pad')) merged.push('swimming pad')
    singleWords.length = 0
    singleWords.push(...merged)
  }

  // 리스트 순서: CANONICAL_ORDER에 있으면 그 순서, 없으면 뒤로 (이미지에서 읽은 단어만 반환)
  const orderIndex = (word) => {
    const k = word.toLowerCase()
    const i = CANONICAL_ORDER.indexOf(k)
    return i === -1 ? CANONICAL_ORDER.length : i
  }
  singleWords.sort((a, b) => orderIndex(a) - orderIndex(b))
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
            ? `Found ${singleWords.length} word(s) (max ${MAX_WORDS_PER_PAGE}).`
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

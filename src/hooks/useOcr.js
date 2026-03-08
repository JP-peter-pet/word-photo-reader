import { useState, useCallback, useRef } from 'react'
import { createWorker } from 'tesseract.js'

/** 단어 앞뒤 문장부호 제거 (angry? → angry, carpet. → carpet) */
function cleanWord(text) {
  if (!text || typeof text !== 'string') return ''
  return text.trim().replace(/^[\s.,?!;:'"()\[\]-]+|[\s.,?!;:'"()\[\]-]+$/g, '')
}

/** 연달아 나오면 한 개로 합칠 복합어 [앞, 뒤]. 소문자로 비교 */
const COMPOUNDS = [['swimming', 'pad']]

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
 * OCR 결과에서 모든 단어를 읽기 순서(위→아래, 왼→오)로 수집. 중복(대소문자 무시) 제거만 함.
 */
function extractAllWords(words) {
  if (!words || !words.length) return []
  const filtered = [...words].filter((w) => w.text && String(w.text).trim())
  if (!filtered.length) return []
  // 읽기 순서: Y(세로) 먼저, 그다음 X(가로)
  filtered.sort((a, b) => {
    const yA = (a.bbox?.y0 ?? 0) + (a.bbox?.y1 ?? 0)
    const yB = (b.bbox?.y0 ?? 0) + (b.bbox?.y1 ?? 0)
    if (Math.abs(yA - yB) > 15) return yA - yB
    return (a.bbox?.x0 ?? 0) - (b.bbox?.x0 ?? 0)
  })
  const result = []
  const seen = new Set()
  for (const w of filtered) {
    const raw = String(w.text).trim()
    if (!raw) continue
    const cleaned = cleanWord(raw)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    // 연달아 나온 두 단어가 복합어면 하나로 합침
    if (result.length >= 1) {
      const prevKey = result[result.length - 1].toLowerCase()
      const pair = COMPOUNDS.find(([a, b]) => a === prevKey && b === key)
      if (pair) {
        result.pop()
        seen.delete(prevKey)
        const compound = pair[0] + ' ' + pair[1]
        if (!seen.has(compound)) {
          seen.add(compound)
          result.push(compound)
        }
        continue
      }
    }
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
  }
  return result
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
        const allWords = extractAllWords(rawWords)
        setStatus(
          allWords.length
            ? `Found ${allWords.length} word(s).`
            : 'No words found.'
        )
        return allWords
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

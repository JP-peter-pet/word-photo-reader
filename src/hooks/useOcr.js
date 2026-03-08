import { useState, useCallback, useRef } from 'react'
import Ocr from '@gutenye/ocr-browser'

const OCR_MODELS = {
  detectionPath: 'https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/ch_PP-OCRv4_det_infer.onnx',
  recognitionPath: 'https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/ch_PP-OCRv4_rec_infer.onnx',
  dictionaryPath: 'https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets/ppocr_keys_v1.txt',
}

/** 단어 앞뒤 문장부호 제거 (angry? → angry, carpet. → carpet) */
function cleanWord(text) {
  if (!text || typeof text !== 'string') return ''
  return text.trim().replace(/^[\s.,?!;:'"()\[\]-]+|[\s.,?!;:'"()\[\]-]+$/g, '')
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
 * data URL → 캔버스로 그린 뒤 PNG data URL로 변환.
 * 크롬 등에서 특정 형식(HEIC, 일부 JPEG) 디코딩 실패 시에도 PNG로 통일해 OCR에 전달.
 */
function dataUrlToPngDataUrl(dataUrl) {
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
      try {
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('The source image cannot be decoded.'))
    img.src = dataUrl
  })
}

/**
 * PaddleOCR Line[] → { text, bbox }[]. 한 줄은 공백이 있어도 하나의 단어로 취급.
 */
function linesToWords(lines) {
  if (!lines || !lines.length) return []
  const words = []
  for (const line of lines) {
    const text = (line.text || '').trim().replace(/\s+/g, ' ')
    if (!text) continue
    const box = line.box
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0
    if (box && Array.isArray(box) && box.length) {
      const flat = typeof box[0] === 'number' ? box : box.flat()
      const xs = flat.filter((_, i) => i % 2 === 0)
      const ys = flat.filter((_, i) => i % 2 === 1)
      if (xs.length && ys.length) {
        x0 = Math.min(...xs)
        y0 = Math.min(...ys)
        x1 = Math.max(...xs)
        y1 = Math.max(...ys)
      }
    }
    const bbox = { x0, y0, x1, y1 }
    words.push({ text, bbox })
  }
  return words
}

/**
 * OCR 결과를 읽기 순서(위→아래, 왼→오)로 정렬하고 중복(대소문자 무시) 제거.
 */
function extractAllWords(words) {
  if (!words || !words.length) return []
  const filtered = [...words].filter((w) => w.text && String(w.text).trim())
  if (!filtered.length) return []
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
  const ocrRef = useRef(null)

  const ensureOcr = useCallback(async () => {
    if (ocrRef.current) return ocrRef.current
    setStatus('Loading OCR engine (PaddleOCR)...')
    try {
      const ocr = await Ocr.create({ models: OCR_MODELS })
      ocrRef.current = ocr
      setIsReady(true)
      setStatus('Upload an image or take a photo, then tap Process Image.')
      return ocr
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
        const ocr = await ensureOcr()
        const dataUrl = await ensureDataUrl(imageSrc)
        const pngDataUrl = await dataUrlToPngDataUrl(dataUrl)
        const lines = await ocr.detect(pngDataUrl)
        const rawWords = linesToWords(lines)
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
        return []
      } finally {
        setIsProcessing(false)
      }
    },
    [ensureOcr]
  )

  const setReadyStatus = useCallback(() => {
    setStatus(isReady ? 'Upload an image or take a photo, then tap Process Image.' : 'Initializing OCR engine...')
  }, [isReady])

  return { runOcr, status, setStatus, isProcessing, isReady, setReadyStatus }
}

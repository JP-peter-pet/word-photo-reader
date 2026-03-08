import { useState, useCallback, useRef, useEffect } from 'react'

const LANG = 'en-US'

/** en-US 우선, 품질 좋은 음성(Google/Microsoft/Apple 기본) 우선 선택 */
function getEnglishVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  const en = voices.filter((v) => v.lang === 'en-US' || v.lang.startsWith('en-'))
  if (!en.length) return voices.find((v) => v.lang.startsWith('en')) || voices[0]
  const name = (v) => (v.name || '').toLowerCase()
  const preferred = en.find((v) => name(v).includes('google') || name(v).includes('samantha') || name(v).includes('alex') || name(v).includes('daniel'))
  if (preferred) return preferred
  const defaultEn = en.find((v) => v.default)
  if (defaultEn) return defaultEn
  return en[0]
}

export function useTts({ repeatCount = 5, delayMs = 2000 }) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [currentWord, setCurrentWord] = useState(null)
  const queueRef = useRef([])
  const timeoutRef = useRef(null)
  const voicesReadyRef = useRef(false)
  const runIdRef = useRef(0)

  useEffect(() => {
    const syn = window.speechSynthesis
    if (!syn) return
    const onVoicesChanged = () => { voicesReadyRef.current = true }
    if (syn.getVoices().length > 0) voicesReadyRef.current = true
    syn.addEventListener('voiceschanged', onVoicesChanged)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && syn.paused) syn.resume?.()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      syn.removeEventListener('voiceschanged', onVoicesChanged)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    runIdRef.current += 1
    window.speechSynthesis?.cancel()
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    queueRef.current = []
    setIsSpeaking(false)
    setCurrentWord(null)
  }, [])

  const SAFETY_MS = 12000
  const ENGINE_SETTLE_MS = 220
  const WARMUP_TEXT = '\u00A0'

  const speakOnce = useCallback((word, onEnd) => {
    if (!word || !window.speechSynthesis) {
      onEnd?.()
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (safetyId) clearTimeout(safetyId)
      onEnd?.()
    }
    const u = new SpeechSynthesisUtterance(String(word).trim())
    u.lang = LANG
    u.rate = 0.85
    u.pitch = 1
    const voice = getEnglishVoice()
    if (voice) u.voice = voice
    u.onend = finish
    u.onerror = finish
    const safetyId = setTimeout(finish, SAFETY_MS)
    window.speechSynthesis.speak(u)
  }, [])

  const speakWord = useCallback(
    (word) => {
      stopSpeaking()
      const w = String(word).trim()
      if (!w) return
      runIdRef.current += 1
      const myRunId = runIdRef.current
      setCurrentWord(w)
      setIsSpeaking(true)
      let count = 0
      const next = () => {
        if (myRunId !== runIdRef.current) return
        count += 1
        if (count > repeatCount) {
          if (myRunId === runIdRef.current) {
            setIsSpeaking(false)
            setCurrentWord(null)
          }
          return
        }
        speakOnce(w, () => {
          if (myRunId !== runIdRef.current) return
          if (count < repeatCount) {
            timeoutRef.current = setTimeout(next, delayMs)
          } else {
            if (myRunId === runIdRef.current) {
              setIsSpeaking(false)
              setCurrentWord(null)
            }
          }
        })
      }
      timeoutRef.current = setTimeout(next, ENGINE_SETTLE_MS)
    },
    [repeatCount, delayMs, speakOnce, stopSpeaking]
  )

  const LIST_DELAY_MS = 1200

  const speakWordList = useCallback(
    (wordList) => {
      if (!wordList?.length || !window.speechSynthesis) return
      stopSpeaking()
      runIdRef.current += 1
      const myRunId = runIdRef.current
      const list = [...wordList]
      setIsSpeaking(true)
      let wordIndex = 0
      let repeatIndex = 0
      const next = () => {
        if (myRunId !== runIdRef.current) return
        if (wordIndex >= list.length) {
          if (myRunId === runIdRef.current) {
            setIsSpeaking(false)
            setCurrentWord(null)
          }
          return
        }
        const w = String(list[wordIndex]).trim()
        if (!w) {
          wordIndex += 1
          repeatIndex = 0
          timeoutRef.current = setTimeout(next, 300)
          return
        }
        if (myRunId !== runIdRef.current) return
        setCurrentWord(w)
        speakOnce(w, () => {
          if (myRunId !== runIdRef.current) return
          repeatIndex += 1
          if (repeatIndex >= repeatCount) {
            wordIndex += 1
            repeatIndex = 0
            timeoutRef.current = setTimeout(next, LIST_DELAY_MS)
          } else {
            timeoutRef.current = setTimeout(next, delayMs)
          }
        })
      }
      const startList = () => {
        if (myRunId !== runIdRef.current) return
        speakOnce(WARMUP_TEXT, () => {
          if (myRunId !== runIdRef.current) return
          timeoutRef.current = setTimeout(next, 80)
        })
      }
      timeoutRef.current = setTimeout(startList, ENGINE_SETTLE_MS)
    },
    [speakOnce, stopSpeaking, repeatCount, delayMs]
  )

  return { speakWord, speakWordList, stopSpeaking, isSpeaking, currentWord }
}

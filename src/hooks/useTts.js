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
  const intervalRef = useRef(null)
  const voicesReadyRef = useRef(false)
  const runIdRef = useRef(0)
  const utteranceRef = useRef(null)

  const [speechSupported, setSpeechSupported] = useState(() => typeof window !== 'undefined' && !!window.speechSynthesis)

  useEffect(() => {
    const syn = window.speechSynthesis
    setSpeechSupported(!!syn)
    if (!syn) return
    const onVoicesChanged = () => { voicesReadyRef.current = true }
    if (syn.getVoices().length > 0) voicesReadyRef.current = true
    syn.addEventListener('voiceschanged', onVoicesChanged)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && typeof syn.resume === 'function' && syn.paused) syn.resume()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      syn.removeEventListener('voiceschanged', onVoicesChanged)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    runIdRef.current += 1
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    try {
      window.speechSynthesis?.cancel()
    } catch (_) {}
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    utteranceRef.current = null
    queueRef.current = []
    setIsSpeaking(false)
    setCurrentWord(null)
  }, [])

  const SAFETY_MS = 5000
  const RESUME_INTERVAL_MS = 1400
  const AFTER_PRIME_MS = 30

  /** 모든 브라우저: 사용자 제스처와 같은 틱에서 첫 speak() 호출 (Chrome/iOS 정책). 빈 발화로 엔진 활성화. */
  const PRIME_SAFETY_MS = 600
  const primeSync = useCallback((onEnd) => {
    const syn = window.speechSynthesis
    if (!syn) {
      onEnd?.()
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (tid) clearTimeout(tid)
      onEnd?.()
    }
    let tid = setTimeout(finish, PRIME_SAFETY_MS)
    try {
      const u = new SpeechSynthesisUtterance('\u00A0')
      if (typeof u.volume !== 'undefined') u.volume = 0.01
      u.rate = 2
      u.lang = LANG
      u.onend = finish
      u.onerror = finish
      syn.speak(u)
    } catch (_) {
      finish()
    }
  }, [])

  const speakOnce = useCallback((word, onEnd) => {
    if (!word || !window.speechSynthesis) {
      onEnd?.()
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      utteranceRef.current = null
      if (safetyId) clearTimeout(safetyId)
      onEnd?.()
    }
    const text = String(word).trim() + '\u00A0'
    const u = new SpeechSynthesisUtterance(text)
    utteranceRef.current = u
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
      const w = String(word).trim()
      if (!w) return
      if (isSpeaking) {
        stopSpeaking()
        runIdRef.current += 1
      } else {
        runIdRef.current += 1
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
      const myRunId = runIdRef.current
      setCurrentWord(w)
      setIsSpeaking(true)
      const syn = window.speechSynthesis
      if (syn && !intervalRef.current) {
        intervalRef.current = setInterval(() => {
          if (syn.paused) syn.resume?.()
        }, RESUME_INTERVAL_MS)
      }
      let count = 0
      const next = () => {
        if (myRunId !== runIdRef.current) return
        count += 1
        if (count > repeatCount) {
          if (myRunId === runIdRef.current) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
            }
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
              if (intervalRef.current) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
              }
              setIsSpeaking(false)
              setCurrentWord(null)
            }
          }
        })
      }
      primeSync(() => {
        if (myRunId !== runIdRef.current) return
        timeoutRef.current = setTimeout(next, AFTER_PRIME_MS)
      })
    },
    [repeatCount, delayMs, speakOnce, stopSpeaking, primeSync, isSpeaking]
  )

  const LIST_DELAY_MS = 1200

  const LIST_DELAY_MS = 1200

  const speakWordList = useCallback(
    (wordList) => {
      if (!wordList?.length || !window.speechSynthesis) return
      if (isSpeaking) {
        stopSpeaking()
        runIdRef.current += 1
      } else {
        runIdRef.current += 1
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
      const myRunId = runIdRef.current
      const list = [...wordList]
      setIsSpeaking(true)
      const syn = window.speechSynthesis
      if (syn && !intervalRef.current) {
        intervalRef.current = setInterval(() => {
          if (syn.paused) syn.resume?.()
        }, RESUME_INTERVAL_MS)
      }
      let wordIndex = 0
      let repeatIndex = 0
      const next = () => {
        if (myRunId !== runIdRef.current) return
        if (wordIndex >= list.length) {
          if (myRunId === runIdRef.current) {
            if (intervalRef.current) {
              clearInterval(intervalRef.current)
              intervalRef.current = null
            }
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
      primeSync(() => {
        if (myRunId !== runIdRef.current) return
        timeoutRef.current = setTimeout(next, AFTER_PRIME_MS)
      })
    },
    [speakOnce, stopSpeaking, repeatCount, delayMs, primeSync, isSpeaking]
  )

  return { speakWord, speakWordList, stopSpeaking, isSpeaking, currentWord, speechSupported }
}

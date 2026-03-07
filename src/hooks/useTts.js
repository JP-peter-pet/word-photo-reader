import { useState, useCallback, useRef, useEffect } from 'react'

const LANG = 'en-US'

function getEnglishVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  const en = voices.find((v) => v.lang === 'en-US' || v.lang.startsWith('en'))
  return en || voices[0]
}

export function useTts({ repeatCount = 5, delayMs = 2000 }) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [currentWord, setCurrentWord] = useState(null)
  const queueRef = useRef([])
  const timeoutRef = useRef(null)
  const voicesReadyRef = useRef(false)

  useEffect(() => {
    const syn = window.speechSynthesis
    if (!syn) return
    const onVoicesChanged = () => { voicesReadyRef.current = true }
    if (syn.getVoices().length > 0) voicesReadyRef.current = true
    syn.addEventListener('voiceschanged', onVoicesChanged)
    return () => syn.removeEventListener('voiceschanged', onVoicesChanged)
  }, [])

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel()
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    queueRef.current = []
    setIsSpeaking(false)
    setCurrentWord(null)
  }, [])

  const speakOnce = useCallback((word, onEnd) => {
    if (!word || !window.speechSynthesis) {
      onEnd?.()
      return
    }
    const u = new SpeechSynthesisUtterance(String(word).trim())
    u.lang = LANG
    u.rate = 0.95
    const voice = getEnglishVoice()
    if (voice) u.voice = voice
    u.onend = () => onEnd?.()
    u.onerror = () => onEnd?.()
    window.speechSynthesis.speak(u)
  }, [])

  const speakWord = useCallback(
    (word) => {
      stopSpeaking()
      const w = String(word).trim()
      if (!w) return
      setCurrentWord(w)
      setIsSpeaking(true)
      let count = 0

      const next = () => {
        count += 1
        if (count > repeatCount) {
          setIsSpeaking(false)
          setCurrentWord(null)
          return
        }
        speakOnce(w, () => {
          if (count < repeatCount) {
            timeoutRef.current = setTimeout(next, delayMs)
          } else {
            setIsSpeaking(false)
            setCurrentWord(null)
          }
        })
      }
      next()
    },
    [repeatCount, delayMs, speakOnce, stopSpeaking]
  )

  return { speakWord, stopSpeaking, isSpeaking, currentWord }
}
